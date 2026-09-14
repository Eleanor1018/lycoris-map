import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(projectRoot, 'src', 'doc_images')
const targetDir = path.join(projectRoot, 'public', 'doc_images')

const IMAGE_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.gif',
    '.svg',
    '.avif',
    '.bmp',
])

async function exists(dirPath) {
    try {
        await stat(dirPath)
        return true
    } catch {
        return false
    }
}

async function syncDocImages() {
    if (!(await exists(sourceDir))) {
        console.log(`[sync-doc-images] source dir missing: ${sourceDir}`)
        return
    }

    await mkdir(targetDir, { recursive: true })
    const items = await readdir(sourceDir, { withFileTypes: true })

    let copiedCount = 0
    for (const item of items) {
        if (!item.isFile()) continue
        const ext = path.extname(item.name).toLowerCase()
        if (!IMAGE_EXTENSIONS.has(ext)) continue

        const from = path.join(sourceDir, item.name)
        const to = path.join(targetDir, item.name)
        await cp(from, to, { force: true })
        copiedCount += 1
    }

    console.log(`[sync-doc-images] copied ${copiedCount} image(s) to ${targetDir}`)
}

await syncDocImages()
