import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ClipSchema,
  MediaSchema,
  ProjectSchema,
  type ExportJob,
  type Project,
  type QueueState
} from '../shared/model'

const JobSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectName: z.string(),
  clip: ClipSchema,
  media: MediaSchema,
  outputDirectory: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
  progress: z.number().finite().min(0).max(1),
  outputPath: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.number()
})
const DiskSchema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectSchema),
  jobs: z.array(JobSchema)
})

export class Store {
  projects: Project[] = []
  queue: QueueState = { version: 1, running: false, jobs: [] }
  private writes: Promise<void> = Promise.resolve()
  readonly file: string
  constructor(readonly root: string) {
    this.file = join(root, 'library.json')
  }
  async load() {
    await mkdir(this.root, { recursive: true })
    try {
      const data = DiskSchema.parse(JSON.parse(await readFile(this.file, 'utf8')))
      this.projects = data.projects
      this.queue.jobs = data.jobs.map((job) =>
        job.status === 'running'
          ? ({
              ...job,
              status: 'interrupted',
              error: 'App closed during export. Retry to start this reel again.',
              progress: 0
            } as ExportJob)
          : job
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Keep a recoverable copy instead of overwriting unreadable user data.
        await rename(this.file, `${this.file}.recovery-${Date.now()}`)
      }
    }
  }
  persist(): Promise<void> {
    const data = JSON.stringify(
      { version: 1, projects: this.projects, jobs: this.queue.jobs },
      null,
      2
    )
    const run = this.writes
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true })
        const temporary = `${this.file}.${randomUUID()}.tmp`
        await writeFile(temporary, data, 'utf8')
        await rename(temporary, this.file)
      })
    this.writes = run
    return run
  }
  getProject(id: string): Project {
    const project = this.projects.find((p) => p.id === id)
    if (!project) throw new Error('Project not found.')
    return project
  }
  async saveProject(input: unknown) {
    const project = ProjectSchema.parse(input)
    const existing = this.getProject(project.id)
    if (JSON.stringify(project.media) !== JSON.stringify(existing.media))
      throw new Error('Use Relink source to change a project’s video.')
    this.projects = this.projects.map((p) =>
      p.id === project.id ? { ...project, updatedAt: Date.now() } : p
    )
    await this.persist()
  }
}
