import { loadTencentSdk } from './sdk'

export function loadTencentResources(background = false) {
    return Promise.all([loadTencentSdk(background), import('./coordinates')])
}
