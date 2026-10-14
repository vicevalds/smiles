import { parseDelimitedLine } from './csv'

export const bindSmilesColumn = (form: HTMLFormElement, onSelect: (text: string) => void) => {
	const panel = form.querySelector<HTMLElement>('#smiles-column-panel')!
	const select = form.querySelector<HTMLSelectElement>('#smiles-column')!
	const placeholder = select.options[0]
	let pending: { text: string; header: string[]; delimiter: string; start: number; end: number } | null = null

	const reset = () => {
		pending = null
		delete panel.dataset.open
		panel.inert = true
		select.disabled = true
		select.replaceChildren(placeholder)
		select.value = ''
	}

	form.querySelector('#smiles-file')!.addEventListener('change', reset)
	form.querySelector('#smiles-text')!.addEventListener('input', reset)
	form.addEventListener('viewer:clean', reset)

	select.addEventListener('change', () => {
		if (!pending || select.value === '') return
		const { text, header, delimiter, start, end } = pending
		const columns = header.map((column, index) => index === Number(select.value) ? 'SMILES' : column)
		const firstLine = columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(delimiter)
		onSelect(text.slice(0, start) + firstLine + text.slice(end))
	})

	return (text: string, delimiter: string) => {
		const firstLine = /\S[^\r\n]*/.exec(text)
		if (!firstLine) return false
		const header = parseDelimitedLine(firstLine[0], delimiter)
		if (header.some((column) => column.trim().toLowerCase() === 'smiles')) return false

		pending = { text, header, delimiter, start: firstLine.index, end: firstLine.index + firstLine[0].length }
		select.replaceChildren(placeholder, ...header.map((column, index) =>
			new Option(column || `Column ${index + 1}`, String(index)),
		))
		select.value = ''
		select.disabled = false
		panel.inert = false
		panel.dataset.open = 'true'
		select.focus({ preventScroll: true })
		return true
	}
}
