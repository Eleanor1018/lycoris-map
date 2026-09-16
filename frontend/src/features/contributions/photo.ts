export const PHOTO_LIMIT = 5 * 1024 * 1024
export function checkPhotoFile(file: File) {
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type))
        throw new Error('Choose a JPEG, PNG, GIF or WebP photo.')
    if (file.size === 0 || file.size > PHOTO_LIMIT)
        throw new Error('Choose a photo between 1 byte and 5 MiB.')
}
export function checkPhotoSize(width: number, height: number) {
    if (!width || !height || width > 10000 || height > 10000 || width * height > 25000000)
        throw new Error(
            'Photo dimensions must be at most 10,000 pixels per side and 25 megapixels.',
        )
}
export async function inspectPhoto(file: File) {
    checkPhotoFile(file)
    const url = URL.createObjectURL(file)
    try {
        const image = new Image()
        image.src = url
        await image.decode()
        checkPhotoSize(image.naturalWidth, image.naturalHeight)
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('Photo dimensions')) throw error
        throw new Error('This photo could not be read. Choose another image.')
    } finally {
        URL.revokeObjectURL(url)
    }
}
