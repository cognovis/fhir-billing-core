// Compare actual public-emitter output with the IG's owned contract inventory.
export function assertIgDefinitions(resources, definitions) {
  const defined = new Set(extensionDefinitionUrls(definitions))
  const codeSystems = new Map(definitions.filter((resource) => resource.resourceType === 'CodeSystem')
    .map((resource) => [resource.url, resource]))
  function codes(concepts = []) {
    return concepts.flatMap((concept) => [concept.code, ...codes(concept.concept)])
  }
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit)
    if (value === null || typeof value !== 'object') return
    for (const extension of [...(value.extension ?? []), ...(value.modifierExtension ?? [])]) {
      if (/^https?:/.test(extension.url) && !defined.has(extension.url)) throw new Error(`Emitted extension not defined in the Billing Core IG: ${extension.url}`)
    }
    if (typeof value.system === 'string' && typeof value.code === 'string' && value.system.startsWith('https://fhir.cognovis.de/billing-core/')) {
      const definition = codeSystems.get(value.system)
      if (definition === undefined) throw new Error(`Emitted CodeSystem not defined in the Billing Core IG: ${value.system}`)
      if (!codes(definition.concept).includes(value.code)) throw new Error(`Emitted code undefined in the IG: ${value.system}#${value.code}`)
    }
    Object.values(value).forEach(visit)
  }
  resources.forEach(visit)
}

export function sourceDefinitions(fsh) {
  return fsh.split(/(?=^(?:Extension|Profile|Instance|Invariant|RuleSet|Alias|CodeSystem|ValueSet):)/m)
    .filter((block) => /^(Extension|CodeSystem):/.test(block))
    .map((block) => {
      const url = /^\* \^url = "([^"]+)"$/m.exec(block)?.[1]
      return block.startsWith('Extension:')
        ? { resourceType: 'StructureDefinition', type: 'Extension', derivation: 'constraint', url }
        : { resourceType: 'CodeSystem', url, concept: [...block.matchAll(/^\* (?:#[^\s]+ )*#([^\s]+)/gm)].map((match) => ({ code: match[1] })) }
    })
}

export function extensionDefinitionUrls(resources) {
  const definitions = resources.filter((resource) => resource.resourceType === 'StructureDefinition')
  for (const definition of definitions) {
    if (definition.type !== 'Extension' || definition.derivation !== 'constraint') {
      throw new Error(`Billing Core must not generate custom resource profiles: ${definition.url}`)
    }
  }
  return definitions.map((definition) => definition.url)
}
