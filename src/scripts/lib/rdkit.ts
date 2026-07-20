import { formatMB } from './files'

export type RDKitMol = {
	is_valid: () => boolean
	get_descriptors: () => string
	get_svg: (w: number, h: number) => string
	delete: () => void
}

export type RDKitModule = { get_mol: (smiles: string) => RDKitMol | null }
type RDKitConfig = { wasmBinary?: ArrayBuffer }

declare global {
	interface Window {
		initRDKitModule: (config?: RDKitConfig) => Promise<RDKitModule>
	}
}

const RDKIT_DOWNLOADED_KEY = 'rdkit-downloaded'

const rdkitDownloaded = () => localStorage.getItem(RDKIT_DOWNLOADED_KEY) === '1'

const fetchWithProgress = async (
	url: string,
	onProgress: (received: number, total: number) => void,
) => {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
	const total = Number(response.headers.get('content-length')) || 0
	if (!response.body) return response.arrayBuffer()

	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let received = 0

	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		chunks.push(value)
		received += value.length
		onProgress(received, total)
	}

	const bytes = new Uint8Array(received)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.length
	}
	return bytes.buffer
}

const loadScript = (src: string) =>
	new Promise<void>((resolve, reject) => {
		const script = document.createElement('script')
		script.src = src
		script.onload = () => resolve()
		script.onerror = () => reject(new Error(`Failed to load ${src}`))
		document.head.append(script)
	})

export const createRDKitLoader = ({
	onStatus,
	onReady,
}: {
	onStatus?: (message: string) => void
	onReady?: (module: RDKitModule) => void
} = {}) => {
	let promise: Promise<RDKitModule> | null = null

	return () => {
		if (!promise) {
			promise = (async () => {
				const firstDownload = !rdkitDownloaded()
				const [, wasmBinary] = await Promise.all([
					loadScript('/RDKit_minimal.js'),
					fetchWithProgress('/RDKit_minimal.wasm', (received) => {
						if (firstDownload) onStatus?.(`Downloading RDKit ${formatMB(received)}/6.6 MB`)
					}),
				])
				const module = await window.initRDKitModule({ wasmBinary })
				onReady?.(module)
				if (firstDownload) {
					localStorage.setItem(RDKIT_DOWNLOADED_KEY, '1')
					onStatus?.('Downloading RDKit, done.')
				}
				return module
			})()
			promise.catch(() => {
				promise = null
			})
		}
		return promise
	}
}

export const requestIdle =
	window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 200))
