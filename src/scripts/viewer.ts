type RDKitMol = {
	is_valid: () => boolean
	get_svg: (w: number, h: number) => string
	get_json: () => string
	delete: () => void
}
type RDKitModule = { get_mol: (smiles: string) => RDKitMol | null }
type RDKitConfig = { wasmBinary?: ArrayBuffer }

declare global {
	interface Window {
		initRDKitModule: (config?: RDKitConfig) => Promise<RDKitModule>
	}
}

const form = document.querySelector<HTMLFormElement>('#smiles-form')!
const textarea = document.querySelector<HTMLTextAreaElement>('#smiles-text')!
const fileInput = document.querySelector<HTMLInputElement>('#smiles-file')!
const renderBtn = document.querySelector<HTMLButtonElement>('#render-btn')!
const formError = document.querySelector<HTMLParagraphElement>('#form-error')!
const formStatus = document.querySelector<HTMLParagraphElement>('#form-status')!
const gallery = document.querySelector<HTMLUListElement>('#gallery')!
const columns = document.querySelector<HTMLInputElement>('#columns')!
const columnsValue = document.querySelector<HTMLSpanElement>('#columns-value')!
const cardTemplate = document.querySelector<HTMLTemplateElement>('#card-template')!

	const ALLOWED_EXTENSIONS = ['.smi', '.smiles', '.txt']
	const isAllowedFile = (file: File) =>
		ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))
	const MAX_FILE_SIZE = 6.6 * 1048576

	const columnClasses: Record<string, string> = {
	'2': 'grid-cols-2',
	'3': 'grid-cols-3',
	'4': 'grid-cols-4',
	'5': 'grid-cols-5',
	'6': 'grid-cols-6',
	'7': 'grid-cols-7',
	'8': 'grid-cols-8',
}

const applyColumns = () => {
	gallery.classList.remove(...Object.values(columnClasses))
	gallery.classList.add(columnClasses[columns.value])
	columnsValue.textContent = columns.value
}
columns.addEventListener('input', applyColumns)

const formatMB = (bytes: number) => (bytes / 1048576).toFixed(1)

const fetchWithProgress = async (
	url: string,
	onProgress: (received: number, total: number) => void,
) => {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
	const total = Number(res.headers.get('content-length')) || 0
	if (!res.body) return res.arrayBuffer()

	const reader = res.body.getReader()
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

const RDKIT_DOWNLOADED_KEY = 'rdkit-downloaded'
const rdkitDownloaded = () => localStorage.getItem(RDKIT_DOWNLOADED_KEY) === '1'

let rdkitPromise: Promise<RDKitModule> | null = null
const loadRDKit = () => {
	if (!rdkitPromise) {
		rdkitPromise = (async () => {
			const firstDownload = !rdkitDownloaded()
			const [, wasmBinary] = await Promise.all([
				loadScript('/RDKit_minimal.js'),
				fetchWithProgress('/RDKit_minimal.wasm', (received) => {
					if (!firstDownload) return
					showStatus(`Downloading RDKit ${formatMB(received)}/6.6 MB`)
				}),
			])
			const module = await window.initRDKitModule({ wasmBinary })
			renderBtn.disabled = false
			if (firstDownload) {
				localStorage.setItem(RDKIT_DOWNLOADED_KEY, '1')
				showStatus('Downloading RDKit, done.')
				setTimeout(clearStatus, 2000)
			}
			return module
		})()
		rdkitPromise.catch(() => {
			rdkitPromise = null
		})
	}
	return rdkitPromise
}

const requestIdle =
	window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200))
requestIdle(() => loadRDKit())

const parseEntries = (text: string) =>
	text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [smiles, ...rest] = line.split(/\s+/)
			return { smiles, name: rest.join(' ') }
		})

const hashStr = (s: string) => {
	let h = 0x811c9dc5
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return (h >>> 0).toString(36)
}

// Bemis–Murcko scaffold identity: peel side chains down to the ring
// systems plus the linkers between them, then hash the remaining graph
// (Weisfeiler–Lehman, isomorphism-invariant) so molecules sharing a
// scaffold collapse to the same key. Atom elements are ignored (only
// the ring/linker topology and bond orders matter), so heteroatom
// regioisomers — e.g. 2-/3-/4-pyridyl — count as the same scaffold.
const scaffoldKey = (mol: RDKitMol) => {
	type Bond = { bo?: number; atoms: [number, number] }
	type Ext = { name: string; atomRings?: number[][]; aromaticBonds?: number[] }
	const m = JSON.parse(mol.get_json()).molecules[0] as {
		atoms: unknown[]
		bonds: Bond[]
		extensions?: Ext[]
	}
	const { atoms, bonds } = m
	const ext = m.extensions?.find((e) => e.name === 'rdkitRepresentation')
	const aromaticBonds = new Set(ext?.aromaticBonds ?? [])
	const n = atoms.length

	const inRing = new Array<boolean>(n).fill(false)
	for (const ring of ext?.atomRings ?? []) for (const a of ring) inRing[a] = true

	const adj: [number, number][][] = Array.from({ length: n }, () => [])
	bonds.forEach((b, bi) => {
		const [x, y] = b.atoms
		adj[x].push([y, bi])
		adj[y].push([x, bi])
	})

	// Iteratively peel terminal atoms that are not part of any ring.
	const removed = new Array<boolean>(n).fill(false)
	const deg = adj.map((a) => a.length)
	let changed = true
	while (changed) {
		changed = false
		for (let i = 0; i < n; i++) {
			if (removed[i] || inRing[i] || deg[i] > 1) continue
			removed[i] = true
			changed = true
			for (const [nb] of adj[i]) if (!removed[nb]) deg[nb]--
		}
	}

	const keep: number[] = []
	for (let i = 0; i < n; i++) if (!removed[i]) keep.push(i)
	if (keep.length === 0) return 'ACYCLIC'

	// Weisfeiler–Lehman refinement over the surviving scaffold subgraph.
	const local = new Map(keep.map((i, k) => [i, k]))
	let labels = keep.map(() => 'C')
	const nbr = keep.map((i) =>
		adj[i]
			.filter(([nb]) => !removed[nb])
			.map(([nb, bi]): [number, string] => [
				local.get(nb)!,
				aromaticBonds.has(bi) ? 'a' : String(bonds[bi].bo ?? 1),
			]),
	)
	for (let r = 0; r < keep.length; r++) {
		labels = labels.map((lab, k) => {
			const parts = nbr[k].map(([nl, bt]) => `${bt}:${labels[nl]}`).sort()
			return hashStr(`${lab}|${parts.join(',')}`)
		})
	}
	return `${keep.length}#${hashStr(labels.slice().sort().join('#'))}`
}

type Analyzed = { smiles: string; name: string; svg: string; key: string }

const analyze = (
	rdkit: RDKitModule,
	{ smiles, name }: { smiles: string; name: string },
): Analyzed => {
	const mol = rdkit.get_mol(smiles)
	const valid = !!mol && mol.is_valid()
	let svg = '<span class="text-2xl">;(</span>'
	let key = 'INVALID'
	if (valid) {
		svg = mol!.get_svg(300, 300)
		try {
			key = scaffoldKey(mol!)
		} catch {
			key = 'INVALID'
		}
	}
	mol?.delete()
	return { smiles, name, svg, key }
}

const buildCard = ({ smiles, name, svg }: Analyzed, color: string) => {
	const label = name || smiles
	const card = cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement
	card.style.borderColor = color

	card.querySelectorAll<HTMLElement>('[data-svg]').forEach((el) => {
		el.innerHTML = svg
	})

	card.querySelectorAll<HTMLElement>('[data-name]').forEach((el) => {
		el.textContent = label
		el.title = label
		el.style.borderTopColor = color
	})

	return card
}

const showError = (message: string) => {
	formError.textContent = message
	formError.hidden = false
}
const clearError = () => {
	formError.textContent = ''
	formError.hidden = true
}
const showStatus = (message: string) => {
	formStatus.textContent = message
	formStatus.hidden = false
}
const clearStatus = () => {
	formStatus.textContent = ''
	formStatus.hidden = true
}

form.addEventListener('submit', async (event) => {
	event.preventDefault()
	renderBtn.disabled = true
	clearError()

	let text = textarea.value
	const file = fileInput.files?.[0]
	if (file) {
		if (!isAllowedFile(file)) {
			showError(`Allowed files: ${ALLOWED_EXTENSIONS.join(', ')}`)
			fileInput.value = ''
			renderBtn.disabled = false
			return
		}
		if (file.size > MAX_FILE_SIZE) {
			showError('File too large (max 6.6 MB).')
			fileInput.value = ''
			renderBtn.disabled = false
			return
		}
		text += '\n' + (await file.text())
	}

	const entries = parseEntries(text)
	gallery.replaceChildren()

	if (entries.length === 0) {
		renderBtn.disabled = false
		return
	}

	let rdkit: RDKitModule
	try {
		rdkit = await loadRDKit()
	} catch {
		showError('Failed to load the rendering engine. Check your connection and try again.')
		renderBtn.disabled = false
		return
	}

	const BATCH_SIZE = 12
	const nextFrame = () => new Promise(requestAnimationFrame)

	// Pass 1: render each molecule and compute its scaffold key.
	const analyzed: Analyzed[] = []
	for (let i = 0; i < entries.length; i += BATCH_SIZE) {
		for (const entry of entries.slice(i, i + BATCH_SIZE)) {
			analyzed.push(analyze(rdkit, entry))
		}
		showStatus(`Analyzing scaffolds ${analyzed.length}/${entries.length}`)
		await nextFrame()
	}
	clearStatus()

	// Group by scaffold (in order of first appearance) and alternate the
	// border colour between groups: amber, orange, amber, …
	const COLORS = ['var(--accent)', 'var(--accent-2)']
	const groupColor = new Map<string, string>()
	const groupOrder = new Map<string, number>()
	for (const item of analyzed) {
		if (groupColor.has(item.key)) continue
		groupOrder.set(item.key, groupColor.size)
		groupColor.set(item.key, COLORS[groupColor.size % COLORS.length])
	}

	const sorted = analyzed
		.map((item, i) => ({ item, i }))
		.sort((a, b) => groupOrder.get(a.item.key)! - groupOrder.get(b.item.key)! || a.i - b.i)
		.map(({ item }) => item)

	// Pass 2: append the grouped, colour-coded cards.
	for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
		const fragment = document.createDocumentFragment()
		for (const item of sorted.slice(i, i + BATCH_SIZE)) {
			fragment.append(buildCard(item, groupColor.get(item.key)!))
		}
		gallery.append(fragment)
		await nextFrame()
	}

	renderBtn.disabled = false
})

export {}
