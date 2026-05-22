export interface AgentRole {
  id: string;
  name: string;
  description: string;
  skills: string[];
  mcpTools: string[];
}

export const ROLES: Record<string, AgentRole> = {
  pm: {
    id: 'pm', name: 'Product Manager',
    description: 'Requirements gathering, PRD writing, sprint planning, backlog management.',
    skills: ['requirements-elicitation', 'prd-writing', 'scrum'],
    mcpTools: ['file', 'search'],
  },
  arch: {
    id: 'arch', name: 'Architect',
    description: 'Technical review, system design, task breakdown, ADR writing.',
    skills: ['system-design', 'adr-writing'],
    mcpTools: ['file', 'search', 'code-analysis'],
  },
  coder: {
    id: 'coder', name: 'Software Engineer',
    description: 'Implementation, SQL design, API design, bug fixing.',
    skills: ['coding', 'testing', 'debugging'],
    mcpTools: ['file', 'shell', 'search'],
  },
  qa: {
    id: 'qa', name: 'QA Engineer',
    description: 'Test case generation, testing, issue reporting.',
    skills: ['test-design', 'test-execution'],
    mcpTools: ['file', 'shell', 'browser'],
  },
  security: {
    id: 'security', name: 'Security Engineer',
    description: 'Security review, vulnerability scanning, threat modeling.',
    skills: ['security-review', 'owasp'],
    mcpTools: ['file', 'shell', 'search'],
  },
  ui: {
    id: 'ui', name: 'UI/UX Designer',
    description: 'UI/UX design, wireframes, design system compliance.',
    skills: ['ui-design', 'accessibility'],
    mcpTools: ['file', 'browser', 'design-tools'],
  },
  reviewer: {
    id: 'reviewer', name: 'Code Reviewer',
    description: 'Code review, PR feedback.',
    skills: ['code-review'],
    mcpTools: ['file', 'search'],
  },
  'release-manager': {
    id: 'release-manager', name: 'Release Manager',
    description: 'Release coordination, changelog, version tagging.',
    skills: ['release-management'],
    mcpTools: ['file', 'shell'],
  },
  devops: {
    id: 'devops', name: 'DevOps Engineer',
    description: 'CI/CD, infrastructure, deployment.',
    skills: ['ci-cd', 'infrastructure'],
    mcpTools: ['file', 'shell', 'cloud'],
  },
};
