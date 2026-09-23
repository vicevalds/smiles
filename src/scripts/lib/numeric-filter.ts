export type NumericFilterControl = {
	element: HTMLElement
	readonly enabled: boolean
	matches: (candidate: number | string) => boolean
	disable: () => void
	reset: (value?: number | null) => void
	setAvailable: (available: boolean, label?: string) => void
}

type Operator = '>' | '<' | '=' | '~'

const OPERATORS: Operator[] = ['>', '<', '=', '~']
const OPERATOR_LABELS: Record<Operator, string> = {
	'>': 'greater than',
	'<': 'less than',
	'=': 'equal to',
	'~': 'text pattern',
}

export const bindNumericFilter = (
	element: HTMLElement,
	onChange: () => void,
): NumericFilterControl => {
	const operatorButton = element.querySelector<HTMLButtonElement>('[data-filter-operator]')!
	const input = element.querySelector<HTMLInputElement>('[data-filter-input]')!
	const toggleButton = element.querySelector<HTMLButtonElement>('[data-filter-toggle]')!
	let label = element.dataset.filterLabel ?? 'Filter'
	let available = !operatorButton.disabled
	let operator: Operator = '>'
	let enabled = false
	const initialValue = input.value.trim() ? Number(input.value) : Number.NaN
	let value: number | null = Number.isFinite(initialValue) ? initialValue : null
	let pattern: RegExp | null = null
	const numericPlaceholder = input.placeholder

	const update = () => {
		operatorButton.disabled = !available
		input.disabled = !available
		toggleButton.disabled = !available
		operatorButton.textContent = operator
		operatorButton.setAttribute('aria-label', `${label} comparison: ${OPERATOR_LABELS[operator]}`)
		operatorButton.title = 'Click to switch: >, <, =, ~ (text)'
		input.type = operator === '~' ? 'text' : 'number'
		input.inputMode = operator === '~' ? 'text' : 'decimal'
		input.placeholder = operator === '~' ? 'Text / pattern' : numericPlaceholder
		input.title = operator === '~'
			? 'Contains text (case-sensitive). . matches any character; * repeats the preceding character zero or more times. Example: ABC.*'
			: ''
		input.classList.toggle('w-40', operator === '~')
		input.classList.toggle('w-16', operator !== '~')
		input.setAttribute('aria-label', `${label} value`)
		toggleButton.textContent = enabled ? 'On' : 'Off'
		toggleButton.setAttribute('aria-pressed', String(enabled))
	}

	const parseInput = () => {
		const rawValue = input.value.trim()
		if (!rawValue) return null
		const parsed = Number(rawValue)
		const min = input.min === '' ? null : Number(input.min)
		return Number.isFinite(parsed) && (min === null || parsed >= min) ? parsed : null
	}

	const commitInput = () => {
		if (operator === '~') {
			const rawValue = input.value.trim()
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
		const parsed = parseInput()
		if (parsed === null) {
			input.value = value === null ? '' : String(value)
			return false
		}
		value = parsed
		input.value = String(parsed)
		return true
	}

	const setEnabled = (next: boolean) => {
		enabled = available && next && (operator === '~' ? pattern !== null : value !== null)
		update()
	}

	operatorButton.addEventListener('click', () => {
		const wasText = operator === '~'
		const wasEnabled = enabled
		operator = OPERATORS[(OPERATORS.indexOf(operator) + 1) % OPERATORS.length]
		if (wasText || operator === '~') {
			value = null
			pattern = null
			input.value = ''
			input.setCustomValidity('')
			enabled = false
		}
		update()
		if (wasEnabled) onChange()
	})

	input.addEventListener('keydown', (event) => {
		if (operator !== '~' && event.key === '-' && input.min !== '' && Number(input.min) >= 0) {
			event.preventDefault()
			return
		}
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
		if (operator === '~') return
		const min = input.min === '' ? null : Number(input.min)
		const parsed = Number(input.value)
		if (input.value && min !== null && Number.isFinite(parsed) && parsed < min) {
			input.value = String(min)
		}
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
		element,
		get enabled() {
			return enabled
		},
		matches(candidate) {
			if (operator === '~') return pattern?.test(String(candidate)) ?? false
			const numeric = typeof candidate === 'string' && !candidate.trim() ? Number.NaN : Number(candidate)
			if (value === null || !Number.isFinite(numeric)) return false
			if (operator === '>') return numeric > value
			if (operator === '<') return numeric < value
			return numeric === value
		},
		disable() {
			setEnabled(false)
		},
		reset(nextValue = null) {
			operator = '>'
			pattern = null
			input.setCustomValidity('')
			value = nextValue
			input.value = nextValue === null ? '' : String(nextValue)
			setEnabled(false)
		},
		setAvailable(nextAvailable, nextLabel = label) {
			available = nextAvailable
			label = nextLabel
			if (!available) enabled = false
			update()
		},
	}
}
