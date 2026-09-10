export type DisplaySlots = [string | null, string | null, string | null, string | null]
export type SortDirection = 'desc' | 'asc'

export const bindDisplayValues = (
	panel: HTMLElement,
	pillTemplate: HTMLTemplateElement,
	onChange: () => void,
) => {
	const options = panel.querySelector<HTMLElement>('#column-options')!
	const sortButton = panel.querySelector<HTMLButtonElement>('#sort-btn')!
	let slots: DisplaySlots = [null, null, null, null]
	let sortedColumn: string | null = null
	let sortDirection: SortDirection = 'desc'
	let hasColumns = false

	const update = () => {
		options.querySelectorAll<HTMLButtonElement>('[data-column]').forEach((pill) => {
			const slot = slots.indexOf(pill.dataset.column ?? '')
			if (slot === -1) delete pill.dataset.slot
			else pill.dataset.slot = String(slot)
			pill.setAttribute('aria-pressed', String(slot !== -1))
		})
		sortButton.disabled = slots[0] === null
		sortButton.textContent = `Sort ${sortDirection === 'desc' ? '↓' : '↑'}`
	}

	options.addEventListener('click', (event) => {
		const pill = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-column]')
		const column = pill?.dataset.column
		if (!column) return

		const selectedSlot = slots.indexOf(column)
		if (selectedSlot === -1) {
			const emptySlot = slots.indexOf(null)
			if (emptySlot === -1) return
			slots[emptySlot] = column
		} else {
			slots.splice(selectedSlot, 1)
			slots.push(null)
		}

		if (!sortedColumn || !slots.includes(sortedColumn)) {
			sortedColumn = slots[0]
			sortDirection = 'desc'
		}
		update()
		onChange()
	})

	sortButton.addEventListener('click', () => {
		if (!sortedColumn) return
		sortDirection = sortDirection === 'desc' ? 'asc' : 'desc'
		update()
		onChange()
	})

	return {
		get slots() {
			return slots
		},
		get sortedColumn() {
			return sortedColumn
		},
		get sortDirection() {
			return sortDirection
		},
		get hasColumns() {
			return hasColumns
		},
		populate(columns: string[], defaultColumn: string | null = null) {
			hasColumns = columns.length > 0
			slots = [columns.includes(defaultColumn ?? '') ? defaultColumn : null, null, null, null]
			sortedColumn = slots[0]
			sortDirection = 'desc'
			options.replaceChildren()
			for (const column of columns) {
				const pill = pillTemplate.content.firstElementChild!.cloneNode(true) as HTMLButtonElement
				pill.dataset.column = column
				pill.textContent = column
				options.append(pill)
			}
			panel.hidden = !hasColumns
			update()
		},
	}
}
