export type FilterControl = {
	readonly enabled: boolean
	matches: (candidate: number | string) => boolean
	reset: (column: string | null) => void
}

const OPERATORS = ['>', '>=', '<', '<=', '=='] as const
type Operator = typeof OPERATORS[number]
const OPERATOR_LABELS: Record<Operator, string> = {
	'>': 'greater than',
	'>=': 'greater than or equal to',
	'<': 'less than',
	'<=': 'less than or equal to',
	'==': 'matches value or pattern',
}

export const bindFilter = (
	element: HTMLElement,
	onChange: () => void,
): FilterControl => {
	const operatorButton = element.querySelector<HTMLButtonElement>('[data-filter-operator]')!
	const input = element.querySelector<HTMLInputElement>('[data-filter-input]')!
	const toggleButton = element.querySelector<HTMLButtonElement>('[data-filter-toggle]')!
	let label = 'Filter'
	let available = !operatorButton.disabled
	let operator: Operator = '>'
	let enabled = false
	let value: number | null = null
	let pattern: RegExp | null = null

	const clearInput = () => {
		value = null
		pattern = null
		input.value = ''
		input.setCustomValidity('')
		enabled = false
	}

	const update = () => {
		operatorButton.disabled = !available
		input.disabled = !available
		toggleButton.disabled = !available
		operatorButton.textContent = operator
		operatorButton.setAttribute('aria-label', `${label} comparison: ${OPERATOR_LABELS[operator]}`)
		const isPattern = operator === '=='
		input.type = isPattern ? 'text' : 'number'
		input.inputMode = isPattern ? 'text' : 'decimal'
		input.placeholder = isPattern ? 'Value' : '0.0'
		input.title = isPattern
			? 'Contains text (case-sensitive). . matches any character; * repeats the preceding character zero or more times. Example: ABC.*'
			: ''
		input.setAttribute('aria-label', `${label} value`)
		toggleButton.textContent = enabled ? 'On' : 'Off'
		toggleButton.setAttribute('aria-pressed', String(enabled))
	}

	const commitInput = () => {
		const rawValue = input.value.trim()
		if (operator === '==') {
			try {
				pattern = rawValue ? new RegExp(rawValue.replace(/[+?^${}()|[\]\\]/g, '\\$&'), 'u') : null
				input.setCustomValidity('')
				return pattern !== null
			} catch {
				pattern = null
				input.setCustomValidity('Invalid pattern: * must follow a character or . and cannot be repeated.')
				input.reportValidity()
				return false
			}
		}
		const parsed = rawValue ? Number(rawValue) : Number.NaN
		if (!Number.isFinite(parsed)) {
			input.value = value === null ? '' : String(value)
			return false
		}
		value = parsed
		input.value = String(parsed)
		return true
	}

	const setEnabled = (next: boolean) => {
		enabled = available && next && (operator === '==' ? pattern !== null : value !== null)
		update()
	}

	operatorButton.addEventListener('click', () => {
		const wasText = operator === '=='
		const wasEnabled = enabled
		operator = OPERATORS[(OPERATORS.indexOf(operator) + 1) % OPERATORS.length]
		if (wasText || operator === '==') {
			clearInput()
		}
		update()
		if (wasEnabled) onChange()
	})

	input.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter') return
		event.preventDefault()
		setEnabled(commitInput())
		onChange()
		if (enabled) toggleButton.focus()
	})

	input.addEventListener('input', () => {
		input.setCustomValidity('')
	})

	input.addEventListener('change', () => {
		const wasEnabled = enabled
		if (!commitInput()) setEnabled(false)
		if (wasEnabled) onChange()
	})

	toggleButton.addEventListener('click', () => {
		const next = !enabled
		if (next && !commitInput()) {
			input.focus()
			return
		}
		setEnabled(next)
		onChange()
	})

	update()
	return {
		get enabled() {
			return enabled
		},
		matches(candidate) {
			const raw = String(candidate).trim()
			if (!raw) return false
			if (operator === '==') return pattern?.test(raw) ?? false
			const numeric = Number(raw)
			if (value === null || !Number.isFinite(numeric)) return false
			switch (operator) {
				case '>': return numeric > value
				case '>=': return numeric >= value
				case '<': return numeric < value
				case '<=': return numeric <= value
			}
		},
		reset(column) {
			available = column !== null
			label = column ?? 'Filter'
			operator = '>'
			clearInput()
			update()
		},
	}
}
