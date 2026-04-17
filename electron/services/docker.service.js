const Docker = require('dockerode')
const net = require('net')

const GAMALAB_LABEL = 'com.gamalab.managed'
const IMAGE = 'postgres:16'

class DockerService {
  constructor() {
    this.docker = new Docker()
  }

  async checkDocker() {
    try {
      const info = await this.docker.info()
      return {
        installed: true,
        running: true,
        version: info.ServerVersion,
        containers: info.Containers,
        images: info.Images,
      }
    } catch (err) {
      return {
        installed: true,
        running: false,
        error: this._friendlyError(err),
      }
    }
  }

  async _ensureImage(image) {
    try {
      await this.docker.getImage(image).inspect()
      return { pulled: false }
    } catch {
      return new Promise((resolve, reject) => {
        this.docker.pull(image, (err, stream) => {
          if (err) return reject(new Error(`Failed to pull ${image}: ${err.message}`))
          this.docker.modem.followProgress(stream, (err2) => {
            if (err2) return reject(err2)
            resolve({ pulled: true })
          })
        })
      })
    }
  }

  async _getDockerUsedPorts() {
    try {
      const containers = await this.docker.listContainers({ all: true })
      const used = new Set()
      for (const c of containers) {
        for (const p of c.Ports || []) {
          if (p.PublicPort) used.add(p.PublicPort)
        }
      }
      return used
    } catch {
      return new Set()
    }
  }

  async _isPortFreeOnHost(port) {
    return new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close()
        resolve(true)
      })
      server.listen(port, '0.0.0.0')
    })
  }

  async isPortFree(port, dockerPorts = null) {
    const used = dockerPorts || (await this._getDockerUsedPorts())
    if (used.has(port)) return false
    return await this._isPortFreeOnHost(port)
  }

  async findFreePort(start = 5432) {
    const dockerPorts = await this._getDockerUsedPorts()
    let port = start
    while (port < start + 500) {
      if (await this.isPortFree(port, dockerPorts)) return port
      port += 1
    }
    throw new Error('No free port available in range')
  }

  async listContainers() {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { label: [`${GAMALAB_LABEL}=true`] },
      })
      return containers.map((c) => this._mapContainer(c))
    } catch (err) {
      throw new Error(this._friendlyError(err))
    }
  }

  _mapContainer(c) {
    const port = c.Ports?.find((p) => p.PrivatePort === 5432)?.PublicPort ?? null
    return {
      id: c.Id,
      shortId: c.Id.substring(0, 12),
      name: (c.Names?.[0] || '').replace(/^\//, ''),
      image: c.Image,
      state: c.State,
      status: c.Status,
      port,
      labels: c.Labels || {},
      created: c.Created,
    }
  }

  async createPostgresContainer(config) {
    const {
      name,
      port = 5432,
      user = 'postgres',
      password = 'postgres',
      database = 'postgres',
      persistData = true,
      autoResolvePort = true,
    } = config

    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error('Invalid container name. Use letters, numbers, _ and - only.')
    }

    try {
      await this.docker.getContainer(name).inspect()
      throw new Error(`A container named "${name}" already exists.`)
    } catch (err) {
      if (err.statusCode !== 404 && !err.message.includes('no such container')) {
        if (err.message.includes('already exists')) throw err
      }
    }

    let finalPort = port
    if (!(await this.isPortFree(finalPort))) {
      if (!autoResolvePort) {
        throw new Error(`Port ${port} is already in use.`)
      }
      finalPort = await this.findFreePort(port + 1)
    }

    await this._ensureImage(IMAGE)

    const hostConfig = {
      PortBindings: { '5432/tcp': [{ HostPort: String(finalPort) }] },
      RestartPolicy: { Name: 'unless-stopped' },
    }

    if (persistData) {
      hostConfig.Binds = [`gamalab_${name}_data:/var/lib/postgresql/data`]
    }

    const container = await this.docker.createContainer({
      Image: IMAGE,
      name,
      Env: [
        `POSTGRES_USER=${user}`,
        `POSTGRES_PASSWORD=${password}`,
        `POSTGRES_DB=${database}`,
      ],
      Labels: {
        [GAMALAB_LABEL]: 'true',
        'com.gamalab.type': 'postgres',
        'com.gamalab.user': user,
        'com.gamalab.database': database,
      },
      ExposedPorts: { '5432/tcp': {} },
      HostConfig: hostConfig,
    })

    await container.start()

    const info = await container.inspect()
    await this._waitForPostgresReady(finalPort, 30000)

    return {
      id: info.Id,
      shortId: info.Id.substring(0, 12),
      name,
      port: finalPort,
      user,
      password,
      database,
      host: '127.0.0.1',
      state: info.State.Status,
      persistData,
    }
  }

  async _waitForPostgresReady(port, timeoutMs = 30000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const ok = await new Promise((resolve) => {
        const socket = new net.Socket()
        const done = (val) => {
          socket.destroy()
          resolve(val)
        }
        socket.setTimeout(1000)
        socket.once('error', () => done(false))
        socket.once('timeout', () => done(false))
        socket.connect(port, '127.0.0.1', () => done(true))
      })
      if (ok) {
        await new Promise((r) => setTimeout(r, 1500))
        return true
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error('PostgreSQL did not become ready in time')
  }

  async startContainer(id) {
    try {
      await this.docker.getContainer(id).start()
      return { success: true }
    } catch (err) {
      throw new Error(this._friendlyError(err))
    }
  }

  async stopContainer(id) {
    try {
      await this.docker.getContainer(id).stop({ t: 5 })
      return { success: true }
    } catch (err) {
      throw new Error(this._friendlyError(err))
    }
  }

  async restartContainer(id) {
    try {
      await this.docker.getContainer(id).restart({ t: 5 })
      return { success: true }
    } catch (err) {
      throw new Error(this._friendlyError(err))
    }
  }

  async removeContainer(id, removeVolume = false) {
    try {
      const container = this.docker.getContainer(id)
      const info = await container.inspect()
      try {
        await container.stop({ t: 3 })
      } catch {}
      await container.remove({ force: true })
      if (removeVolume) {
        const volumes = info.Mounts?.filter((m) => m.Type === 'volume') || []
        for (const v of volumes) {
          try {
            await this.docker.getVolume(v.Name).remove()
          } catch {}
        }
      }
      return { success: true }
    } catch (err) {
      throw new Error(this._friendlyError(err))
    }
  }

  async getContainerLogs(id) {
    try {
      const container = this.docker.getContainer(id)
      const buffer = await container.logs({
        stdout: true,
        stderr: true,
        tail: 200,
      })
      return buffer.toString('utf-8')
    } catch (err) {
      throw new Error(this._friendlyError(err))
    }
  }

  _friendlyError(err) {
    const msg = err?.message || String(err)
    if (msg.includes('ENOENT') && msg.includes('docker.sock')) {
      return 'Docker daemon is not running. Please start Docker Desktop.'
    }
    if (msg.includes('connect ECONNREFUSED')) {
      return 'Cannot connect to Docker. Please start Docker Desktop.'
    }
    if (msg.includes('EACCES')) {
      return 'Permission denied accessing Docker. Check your user permissions.'
    }
    return msg
  }
}

module.exports = DockerService
