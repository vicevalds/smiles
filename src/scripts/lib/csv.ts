export const parseDelimitedLine = (line: string, delimiter = ','): string[] => {
	const cells: string[] = []
	let cell = ''
	let inQuotes = false

	for (let i = 0; i < line.length; i++) {
		const char = line[i]
		if (inQuotes) {
			if (char === '"') {
				if (line[i + 1] === '"') {
					cell += '"'
					i++
				} else inQuotes = false
			} else cell += char
		} else if (char === '"') inQuotes = true
		else if (char === delimiter) {
			cells.push(cell.trim())
			cell = ''
		} else cell += char
	}

	cells.push(cell.trim())
	return cells
}

export const parseCsvLine = (line: string) => parseDelimitedLine(line)

export const readRows = (text: string) =>
	text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
