import { bindFilter, type FilterControl } from './filter'

type Filter = {
	select: HTMLSelectElement
	column: string | null
	control: FilterControl
}

type ColumnFilters<T> = {
	matches: (item: T) => boolean
	populate: (columns: string[]) => void
}

export const bindColumnFilters = <T>(
	panel: HTMLElement | null,
	onChange: () => void,
	getValue: (item: T, column: string) => string,
): ColumnFilters<T> => {
	if (!panel) {
		return {
			matches: (_item: T) => true,
			populate: (_columns: string[]) => {},
		}
	}

	const list = panel.querySelector<HTMLElement>('#column-filter-list')!
	const template = panel.querySelector<HTMLTemplateElement>('#column-filter-template')!
	let columns: string[] = []
	let filters: Filter[] = []

	const syncOptions = () => {
		const selected = new Set(filters.flatMap((filter) => filter.column ? [filter.column] : []))
		for (const filter of filters) {
			filter.select.replaceChildren(new Option('', ''))
			for (const column of columns) {
				if (column !== filter.column && selected.has(column)) continue
				filter.select.append(new Option(column, column))
			}
			filter.select.value = filter.column ?? ''
		}
	}

	const appendFilter = () => {
		const element = template.content.firstElementChild!.cloneNode(true) as HTMLElement
		const select = element.querySelector<HTMLSelectElement>('[data-filter-column]')!
		const control = bindFilter(element, onChange)
		const filter: Filter = { select, column: null, control }

		select.addEventListener('change', () => {
			filter.column = select.value || null
			control.reset()
			control.setAvailable(filter.column !== null, filter.column ?? 'Filter')

			if (filter.column === null && filters.some((item) => item !== filter && item.column === null)) {
				element.remove()
				filters = filters.filter((item) => item !== filter)
			}
			if (!filters.some((item) => item.column === null)) appendFilter()
			syncOptions()
			onChange()
		})

		filters.push(filter)
		list.append(element)
	}

	return {
		matches(item: T) {
			return filters.every((filter) => {
				if (!filter.control.enabled || !filter.column) return true
				const value = getValue(item, filter.column).trim()
				return value !== '' && filter.control.matches(value)
			})
		},
		populate(nextColumns: string[]) {
			columns = [...new Set(nextColumns.filter(Boolean))]
			filters = []
			list.replaceChildren()
			panel.hidden = columns.length === 0
			if (columns.length === 0) return
			appendFilter()
			syncOptions()
		},
	}
}
