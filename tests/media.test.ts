import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  assertSource,
  exportClip,
  ffmpegPath,
  generateProxy,
  probeMedia,
  rawProbe,
  runProcess
} from '../src/main/media'
import type { Clip } from '../src/shared/model'

describe('real FFmpeg exports', () => {
  let directory: string, source: string
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tokfarm-media-'))
    source = join(directory, 'مباراة sample.mp4')
    await runProcess(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=640x360:r=30:d=3,drawbox=x=320:y=0:w=320:h=360:color=blue:t=fill',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=3',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      source
    ])
  })
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  const clip = (start = 0.5, end = 1.9): Clip => ({
    id: randomUUID(),
    name: 'Goal',
    start,
    end,
    muted: false,
    keyframes: [
      { id: randomUUID(), time: start, x: 0, y: 0.5 },
      { id: randomUUID(), time: end, x: 1, y: 0.5 }
    ]
  })
  it('exports accurate trim, vertical dimensions, synchronized audio, and a moving crop', async () => {
    const media = await probeMedia(source),
      selected = clip()
    const progress: number[] = []
    const output = await exportClip(media, selected, directory, new AbortController().signal, (p) =>
      progress.push(p)
    )
    const data = await rawProbe(output),
      video = data.streams.find((stream: any) => stream.codec_type === 'video'),
      audio = data.streams.find((stream: any) => stream.codec_type === 'audio')
    expect(video.width).toBe(1080)
    expect(video.height).toBe(1920)
    expect(video.codec_name).toBe('h264')
    expect(video.avg_frame_rate).toBe('30/1')
    expect(Number(video.duration)).toBeCloseTo(selected.end - selected.start, 1)
    expect(Math.abs(Number(audio.duration) - Number(video.duration))).toBeLessThan(0.08)
    expect(progress.length).toBeGreaterThan(0)
    async function pixel(time: number, name: string) {
      const path = join(directory, name)
      await runProcess(ffmpegPath, [
        '-loglevel',
        'error',
        '-y',
        '-ss',
        String(time),
        '-i',
        output,
        '-frames:v',
        '1',
        '-vf',
        'scale=1:1',
        '-pix_fmt',
        'rgb24',
        '-f',
        'rawvideo',
        path
      ])
      return readFile(path)
    }
    const first = await pixel(0.05, 'first.rgb'),
      middle = await pixel(0.7, 'middle.rgb'),
      last = await pixel(1.3, 'last.rgb')
    expect(first[0]).toBeGreaterThan(first[2] + 150)
    expect(Math.abs(middle[0] - middle[2])).toBeLessThan(50)
    expect(last[2]).toBeGreaterThan(last[0] + 150)
    const second = await exportClip(
      media,
      selected,
      directory,
      new AbortController().signal,
      () => {}
    )
    expect(second).not.toBe(output)
    expect(second).toContain('(2)')
  })
  it('preserves sports and fractional frame rates, caps output at 60 fps, and supports silent and muted videos', async () => {
    for (const fps of ['50', '60', '120', '30000/1001']) {
      const path = join(directory, `silent-${fps.replace('/', '-')}.mp4`)
      await runProcess(ffmpegPath, [
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=s=320x180:r=${fps}:d=0.5`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        path
      ])
      const media = await probeMedia(path),
        output = await exportClip(
          media,
          { ...clip(0, 0.3), name: `Silent ${fps}` },
          directory,
          new AbortController().signal,
          () => {}
        )
      const data = await rawProbe(output)
      expect(data.streams).toHaveLength(1)
      expect(data.streams[0].avg_frame_rate).toBe(
        fps === '120' ? '60/1' : fps.includes('/') ? fps : `${fps}/1`
      )
    }
    const media = await probeMedia(source),
      output = await exportClip(
        media,
        { ...clip(0, 0.3), name: 'Muted', muted: true },
        directory,
        new AbortController().signal,
        () => {}
      )
    expect((await rawProbe(output)).streams).toHaveLength(1)
  })
  it('normalizes rotated source display dimensions and strips rotation on export', async () => {
    const path = join(directory, 'rotated.mov')
    await runProcess(ffmpegPath, [
      '-loglevel',
      'error',
      '-y',
      '-display_rotation:v:0',
      '90',
      '-i',
      source,
      '-c',
      'copy',
      path
    ])
    const media = await probeMedia(path)
    expect(media.width).toBe(360)
    expect(media.height).toBe(640)
    const output = await exportClip(
      media,
      { ...clip(0, 0.2), name: 'Portrait' },
      directory,
      new AbortController().signal,
      () => {}
    )
    const data = await probeMedia(output)
    expect(data.width).toBe(1080)
    expect(data.height).toBe(1920)
    expect(data.rotation).toBe(0)
  })
  it('generates playable preview copies', async () => {
    const media = await probeMedia(source),
      path = await generateProxy(media, directory, new AbortController().signal, () => {})
    const proxy = await probeMedia(path)
    expect(proxy.codec).toBe('h264')
    expect(Math.abs(proxy.duration - media.duration)).toBeLessThan(0.1)
  })
  it('reports missing, changed, corrupt sources and unwritable destinations; cleans cancelled output', async () => {
    const media = await probeMedia(source)
    await expect(assertSource({ ...media, path: join(directory, 'missing.mp4') })).rejects.toThrow(
      'missing'
    )
    await expect(assertSource({ ...media, size: media.size + 1 })).rejects.toThrow('changed')
    const corrupt = join(directory, 'broken.mp4')
    await writeFile(corrupt, 'not a video')
    await expect(probeMedia(corrupt)).rejects.toThrow()
    await expect(
      exportClip(media, clip(), source, new AbortController().signal, () => {})
    ).rejects.toThrow()
    const controller = new AbortController()
    const exporting = exportClip(
      media,
      { ...clip(0, 2.9), name: 'Cancel me' },
      directory,
      controller.signal,
      () => {}
    )
    setTimeout(() => controller.abort(), 50)
    await expect(exporting).rejects.toThrow('Cancelled')
    expect(
      (await readdir(directory)).some(
        (name) => name.endsWith('.partial.mp4') || name.endsWith('.tokfarm-lock')
      )
    ).toBe(false)
  })
})
