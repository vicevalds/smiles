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
const renderSummary = document.querySelector<HTMLParagraphElement>('#render-summary')!
const summaryRendered = renderSummary.querySelector<HTMLElement>('[data-rendered]')!
const summaryScaffolds = renderSummary.querySelector<HTMLElement>('[data-scaffolds]')!
const columns = document.querySelector<HTMLInputElement>('#columns')!
const columnsValue = document.querySelector<HTMLSpanElement>('#columns-value')!
const cardTemplate = document.querySelector<HTMLTemplateElement>('#card-template')!
const pillTemplate = document.querySelector<HTMLTemplateElement>('#pill-template')!
const displayPanel = document.querySelector<HTMLDivElement>('#display-panel')!
const columnOptions = document.querySelector<HTMLDivElement>('#column-options')!
const sortBtn = document.querySelector<HTMLButtonElement>('#sort-btn')!

const ALLOWED_EXTENSIONS = ['.smi', '.smiles', '.txt', '.csv']
const isAllowedFile = (file: File) =>
	ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))
const MAX_FILE_SIZE = 6.6 * 1048576

// Number of alternating scaffold-group colours defined in the gallery styles.
const GROUP_COLORS = 2

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

type Entry = { smiles: string; id: string; props: Record<string, string> }

// Split one CSV row, honouring double-quoted fields (which may contain commas).
const parseCsvLine = (line: string): string[] => {
	const out: string[] = []
	let cur = ''
	let inQuotes = false
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					cur += '"'
					i++
				} else inQuotes = false
			} else cur += ch
		} else if (ch === '"') inQuotes = true
		else if (ch === ',') {
			out.push(cur)
			cur = ''
		} else cur += ch
	}
	out.push(cur)
	return out.map((s) => s.trim())
}

// Two accepted inputs:
//  - CSV with a header containing SMILES and ID columns (any extra columns become
//    selectable display values).
//  - Legacy whitespace ".smi" lines: "<SMILES> <id>".
const parseInput = (text: string): { entries: Entry[]; columns: string[]; error?: string } => {
	const lines = text
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
	if (lines.length === 0) return { entries: [], columns: [] }

	const header = parseCsvLine(lines[0])
	const lower = header.map((h) => h.toLowerCase())
	const isCsv = header.length > 1 && lower.includes('smiles')

	if (!isCsv) {
		const entries = lines.map((line) => {
			const [smiles, ...rest] = line.split(/\s+/)
			return { smiles, id: rest.join(' '), props: {} }
		})
		return { entries, columns: [] }
	}

	const smilesIdx = lower.indexOf('smiles')
	const idIdx = lower.indexOf('id')
	if (idIdx === -1) return { entries: [], columns: [], error: 'CSV needs an "ID" column.' }

	const extraIdx = header.map((_, i) => i).filter((i) => i !== smilesIdx && i !== idIdx)
	const columns = extraIdx.map((i) => header[i])

	const entries: Entry[] = []
	for (let r = 1; r < lines.length; r++) {
		const cells = parseCsvLine(lines[r])
		const smiles = cells[smilesIdx]
		if (!smiles) continue
		const props: Record<string, string> = {}
		for (const i of extraIdx) props[header[i]] = cells[i] ?? ''
		entries.push({ smiles, id: cells[idIdx] ?? '', props })
	}
	return { entries, columns }
}

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

type Analyzed = Entry & { svg: string; key: string }

const analyze = (rdkit: RDKitModule, entry: Entry): Analyzed => {
	const mol = rdkit.get_mol(entry.smiles)
	const valid = !!mol && mol.is_valid()
	let svg = ''
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
	return { ...entry, svg, key }
}

// Rendered state, kept in scaffold-grouped (base) order so column switches and
// sorting can rearrange the gallery without re-running RDKit.
let items: Analyzed[] = []
let cards: HTMLLIElement[] = []
let scaffoldGroup: number[] = []
let selectedColumn: string | null = null
let sortDir: 'none' | 'desc' | 'asc' = 'none'

const cardValue = (item: Analyzed) => (selectedColumn ? (item.props[selectedColumn] ?? '') : '')

const setCardValue = (card: HTMLLIElement, item: Analyzed) => {
	const el = card.querySelector<HTMLElement>('[data-value]')
	if (!el) return
	const v = cardValue(item)
	el.textContent = v
	el.title = v
}

const buildCard = (item: Analyzed, group: number) => {
	const card = cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement
	card.dataset.group = String(group)
	const svgEl = card.querySelector<HTMLElement>('[data-svg]')
	if (svgEl && item.svg) svgEl.innerHTML = item.svg
	const nameEl = card.querySelector<HTMLElement>('[data-name]')
	if (nameEl) {
		const label = item.id || item.smiles
		nameEl.textContent = label
		nameEl.title = label
	}
	setCardValue(card, item)
	return card
}

// Display order: scaffold-grouped base order, or sorted by the selected column.
// Empty values always sink to the end; numeric columns sort numerically.
const computeOrder = (): number[] => {
	const base = items.map((_, i) => i)
	if (sortDir === 'none' || !selectedColumn) return base
	const col = selectedColumn
	const raw = (i: number) => (items[i].props[col] ?? '').trim()
	const numeric = base.every((i) => raw(i) === '' || Number.isFinite(parseFloat(raw(i))))
	const dir = sortDir === 'desc' ? -1 : 1
	return base.sort((a, b) => {
		const va = raw(a)
		const vb = raw(b)
		if (va === '' || vb === '') return va === vb ? a - b : va === '' ? 1 : -1
		const c = numeric ? parseFloat(va) - parseFloat(vb) : va.localeCompare(vb)
		return c === 0 ? a - b : dir * c
	})
}

const applyLayout = () => {
	// When sorted the scaffold grouping no longer holds, so the gallery flag tells
	// the stylesheet to paint every card amber instead of the per-group colours.
	gallery.toggleAttribute('data-sorted', sortDir !== 'none')
	for (const idx of computeOrder()) gallery.append(cards[idx])
}

const refreshValues = () => {
	for (let i = 0; i < items.length; i++) setCardValue(cards[i], items[i])
}

const updateSortLabel = () => {
	sortBtn.textContent = sortDir === 'desc' ? 'Sort ↓' : sortDir === 'asc' ? 'Sort ↑' : 'Sort'
}

// Reflect the active selection on the pills (single-select, all-off allowed).
// Styling is driven from the markup via the aria-pressed state.
const updatePills = () => {
	columnOptions.querySelectorAll<HTMLButtonElement>('[data-column]').forEach((pill) => {
		pill.setAttribute('aria-pressed', String(pill.dataset.column === selectedColumn))
	})
}

const populatePanel = (cols: string[]) => {
	selectedColumn = null
	sortDir = 'none'
	columnOptions.replaceChildren()
	updateSortLabel()
	sortBtn.disabled = true
	if (cols.length === 0) {
		displayPanel.hidden = true
		return
	}
	displayPanel.hidden = false

	for (const c of cols) {
		const pill = pillTemplate.content.firstElementChild!.cloneNode(true) as HTMLButtonElement
		pill.dataset.column = c
		pill.textContent = c
		columnOptions.append(pill)
	}
}

columnOptions.addEventListener('click', (event) => {
	const pill = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-column]')
	if (!pill) return
	const col = pill.dataset.column!
	selectedColumn = selectedColumn === col ? null : col
	updatePills()
	refreshValues()
	if (!selectedColumn) {
		sortBtn.disabled = true
		if (sortDir !== 'none') {
			sortDir = 'none'
			updateSortLabel()
			applyLayout()
		}
		return
	}
	sortBtn.disabled = false
	if (sortDir !== 'none') applyLayout()
})

sortBtn.addEventListener('click', () => {
	if (!selectedColumn) return
	// Two states only: toggle between descending and ascending. The unsorted
	// scaffold view is restored by deselecting the column pill.
	sortDir = sortDir === 'desc' ? 'asc' : 'desc'
	updateSortLabel()
	applyLayout()
})

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

// Only fills the counts; the wording and styling live in the markup.
const setSummary = (rendered: number, scaffolds: number) => {
	summaryRendered.textContent = String(rendered)
	summaryScaffolds.textContent = String(scaffolds)
	renderSummary.hidden = rendered === 0
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

	const parsed = parseInput(text)
	gallery.replaceChildren()
	items = []
	cards = []
	scaffoldGroup = []
	setSummary(0, 0)
	populatePanel([])

	if (parsed.error) {
		showError(parsed.error)
		renderBtn.disabled = false
		return
	}
	if (parsed.entries.length === 0) {
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
	for (let i = 0; i < parsed.entries.length; i += BATCH_SIZE) {
		for (const entry of parsed.entries.slice(i, i + BATCH_SIZE)) {
			analyzed.push(analyze(rdkit, entry))
		}
		showStatus(`Analyzing scaffolds ${analyzed.length}/${parsed.entries.length}`)
		await nextFrame()
	}
	clearStatus()

	// Group by scaffold (in order of first appearance); the group's parity drives
	// the alternating border colour applied by the gallery stylesheet.
	const groupOrder = new Map<string, number>()
	for (const item of analyzed) {
		if (!groupOrder.has(item.key)) groupOrder.set(item.key, groupOrder.size)
	}

	items = analyzed
		.map((item, i) => ({ item, i }))
		.sort((a, b) => groupOrder.get(a.item.key)! - groupOrder.get(b.item.key)! || a.i - b.i)
		.map(({ item }) => item)
	scaffoldGroup = items.map((item) => groupOrder.get(item.key)! % GROUP_COLORS)

	const uniqueScaffolds = [...groupOrder.keys()].filter(
		(key) => key !== 'INVALID' && key !== 'ACYCLIC',
	).length
	setSummary(items.length, uniqueScaffolds)

	// Pass 2: append the grouped cards.
	for (let i = 0; i < items.length; i += BATCH_SIZE) {
		const fragment = document.createDocumentFragment()
		for (const item of items.slice(i, i + BATCH_SIZE)) {
			const card = buildCard(item, scaffoldGroup[cards.length])
			cards.push(card)
			fragment.append(card)
		}
		gallery.append(fragment)
		await nextFrame()
	}

	populatePanel(parsed.columns)
	renderBtn.disabled = false
})

export {}
