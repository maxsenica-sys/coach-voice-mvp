// lib/video-upload.ts
//
// One path for a coach's video into a session, used by the athlete profile's
// session list and by the session page's own "Add video" button (Max,
// 2026-11-14: add video right on the session, from the phone or the computer).
//
// Three steps, unchanged from the profile's original inline version:
//   1. ask our server for a signed upload URL (no file passes through Next.js);
//   2. PUT the file straight to storage, reporting progress;
//   3. register the video row.
//
// Every step checks the response and throws an Error carrying the server's
// message, so a caller's catch shows the real reason (CLAUDE.md checklist 1).
// Size and codec are checked BEFORE this is called — lib/video-preflight.ts.

export interface UploadProgress {
  /** 0–100. */
  pct: number
  /** "2.1 MB/s · ~40s left", or "Almost done…". */
  eta: string
}

export async function uploadSessionVideo<V = unknown>(
  sessionId: string,
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<V> {
  const mime = file.type || 'video/mp4'

  const urlRes = await fetch(
    `/api/sessions/${sessionId}/videos/upload-url?` +
    new URLSearchParams({ file_name: file.name, mime_type: mime }),
  )
  if (!urlRes.ok) {
    const j = await urlRes.json().catch(() => ({}))
    throw new Error(j?.error ?? 'Failed to prepare upload')
  }
  const { signedUrl, path } = await urlRes.json()

  // PUT with the file as the body is the right method for a Supabase signed
  // upload URL: no multipart parsing, and much faster than POST + FormData.
  const startTime = Date.now()
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !onProgress) return
      const pct = Math.round((e.loaded / e.total) * 100)
      const elapsed = Math.max(0.001, (Date.now() - startTime) / 1000)
      const rate = e.loaded / elapsed
      const remaining = rate > 0 ? (e.total - e.loaded) / rate : Infinity
      const mbps = (rate / (1024 * 1024)).toFixed(1)
      const timeStr = remaining < 5 ? 'Almost done…' : remaining < 60 ? `~${Math.ceil(remaining)}s left` : `~${Math.ceil(remaining / 60)}min left`
      onProgress({ pct, eta: `${mbps} MB/s · ${timeStr}` })
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Upload failed — check your connection.'))
    xhr.open('PUT', signedUrl)
    xhr.setRequestHeader('Content-Type', mime)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.send(file)
  })

  const regRes = await fetch(`/api/sessions/${sessionId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, file_name: file.name, mime_type: mime }),
  })
  if (!regRes.ok) {
    const j = await regRes.json().catch(() => ({}))
    throw new Error(j?.error ?? 'Video uploaded but failed to save record')
  }
  const { video } = await regRes.json()
  return video as V
}
