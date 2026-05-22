/** DOM Contract — interface file format for cross-agent boundaries */
export interface DOMContract {
  version: string;
  components: ComponentContract[];
}

export interface ComponentContract {
  name: string;
  selector: string;
  requiredProps: string[];
  dataAttributes: Record<string, string>;
  accessibility: {
    role: string;
    label: string;
  };
}

export function renderDOMContract(contract: DOMContract): string {
  return `# DOM Contract v${contract.version}\n\n` +
    contract.components.map((c) =>
      `## ${c.name}\nSelector: \`${c.selector}\`\nRequired props: ${c.requiredProps.join(', ')}`
    ).join('\n\n');
}
