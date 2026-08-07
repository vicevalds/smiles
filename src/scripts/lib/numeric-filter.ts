export type NumericFilterControl = {
	element: HTMLElement
	readonly enabled: boolean
	matches: (candidate: number) => boolean
	disable: () => void
	reset: (value?: number | null) => void
	setAvailable: (available: boolean, label?: string) => void
}

type Operator = '>' | '<' | '='

const OPERATORS: Operator[] = ['>', '<', '=']
const OPERATOR_LABELS: Record<Operator, string> = {
	'>': 'greater than',
	'<': 'less than',
	'=': 'equal to',
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

	const update = () => {
		operatorButton.disabled = !available
		input.disabled = !available
		toggleButton.disabled = !available
		operatorButton.textContent = operator
		operatorButton.setAttribute('aria-label', `${label} comparison: ${OPERATOR_LABELS[operator]}`)
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
		enabled = available && next && value !== null
		update()
	}

	operatorButton.addEventListener('click', () => {
		operator = OPERATORS[(OPERATORS.indexOf(operator) + 1) % OPERATORS.length]
		update()
		if (enabled) onChange()
	})

	input.addEventListener('keydown', (event) => {
		if (event.key === '-' && input.min !== '' && Number(input.min) >= 0) {
			event.preventDefault()
			return
		}
		if (event.key !== 'Enter') return
		event.preventDefault()
		if (!commitInput()) return
		setEnabled(true)
		onChange()
		toggleButton.focus()
	})

	input.addEventListener('input', () => {
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
			if (value === null || !Number.isFinite(candidate)) return false
			if (operator === '>') return candidate > value
			if (operator === '<') return candidate < value
			return candidate === value
		},
		disable() {
			setEnabled(false)
		},
		reset(nextValue = null) {
			operator = '>'
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
