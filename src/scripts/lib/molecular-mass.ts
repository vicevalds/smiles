import type { RDKitModule } from './rdkit'

export const MOLECULAR_MASS_COLUMN = 'Molecular Mass'

export const withMolecularMassColumn = (columns: string[]) => [
	MOLECULAR_MASS_COLUMN,
	...columns.filter((column) => column.toLowerCase() !== MOLECULAR_MASS_COLUMN.toLowerCase()),
]

export class MolecularMassResolver {
	private readonly cache = new Map<string, string>()

	cacheDescriptors(smiles: string, descriptorsJson: string) {
		try {
			const descriptors = JSON.parse(descriptorsJson) as { amw?: unknown }
			const mass = Number(descriptors.amw)
			this.cache.set(smiles, Number.isFinite(mass) ? mass.toFixed(1) : '')
		} catch {
			this.cache.set(smiles, '')
		}
	}

	get(smiles: string, rdkitModule: RDKitModule | null) {
		const cached = this.cache.get(smiles)
		if (cached !== undefined) return cached
		if (!rdkitModule) return ''

		const mol = rdkitModule.get_mol(smiles)
		try {
			if (!mol?.is_valid()) {
				this.cache.set(smiles, '')
				return ''
			}
			this.cacheDescriptors(smiles, mol.get_descriptors())
			return this.cache.get(smiles) ?? ''
		} catch {
			this.cache.set(smiles, '')
			return ''
		} finally {
			mol?.delete()
		}
	}

	format(smiles: string, rdkitModule: RDKitModule | null) {
		const mass = this.get(smiles, rdkitModule)
		return mass ? `${mass} Da` : ''
	}

	delete(smiles: string) {
		this.cache.delete(smiles)
	}

	clear() {
		this.cache.clear()
	}
}
