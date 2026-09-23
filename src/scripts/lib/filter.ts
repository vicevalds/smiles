export type FilterControl = {
	readonly enabled: boolean
	matches: (candidate: number | string) => boolean
	reset: () => void
	setAvailable: (available: boolean, label?: string) => void
}

type Operator = '>' | '<' | '='

const OPERATORS: Operator[] = ['>', '<', '=']
const OPERATOR_LABELS: Record<Operator, string> = {
	'>': 'greater than',
	'<': 'less than',
	'=': 'matches value or pattern',
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
		input.type = operator === '=' ? 'text' : 'number'
		input.inputMode = operator === '=' ? 'text' : 'decimal'
		input.placeholder = operator === '=' ? 'Value' : '0.0'
		input.title = operator === '='
			? 'Contains text (case-sensitive). . matches any character; * repeats the preceding character zero or more times. Example: ABC.*'
			: ''
		input.setAttribute('aria-label', `${label} value`)
		toggleButton.textContent = enabled ? 'On' : 'Off'
		toggleButton.setAttribute('aria-pressed', String(enabled))
	}

	const commitInput = () => {
		const rawValue = input.value.trim()
		if (operator === '=') {
			try {
				// Only . and * retain their regular-expression meaning.
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
		enabled = available && next && (operator === '=' ? pattern !== null : value !== null)
		update()
	}

	operatorButton.addEventListener('click', () => {
		const wasText = operator === '='
		const wasEnabled = enabled
		operator = OPERATORS[(OPERATORS.indexOf(operator) + 1) % OPERATORS.length]
		if (wasText || operator === '=') {
			clearInput()
		}
		update()
		if (wasEnabled) onChange()
	})

	input.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter') return
		event.preventDefault()
		if (!commitInput()) {
			setEnabled(false)
			onChange()
			return
		}
		setEnabled(true)
		onChange()
		toggleButton.focus()
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
			if (operator === '=') return pattern?.test(String(candidate)) ?? false
			const numeric = typeof candidate === 'string' && !candidate.trim() ? Number.NaN : Number(candidate)
			if (value === null || !Number.isFinite(numeric)) return false
			return operator === '>' ? numeric > value : numeric < value
		},
		reset() {
			operator = '>'
			clearInput()
			update()
		},
		setAvailable(nextAvailable, nextLabel = label) {
			available = nextAvailable
			label = nextLabel
			if (!available) enabled = false
			update()
		},
	}
}
