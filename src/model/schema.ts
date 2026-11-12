import Ajv from 'ajv';
import schema from './project.schema.json';
import type { Project } from './types';

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

export { schema as projectSchema };

export type ParseResult = { ok: true; project: Project } | { ok: false; errors: string[] };

/** Checks a parsed JSON value against the schema and for dangling references. */
export function parseProject(value: unknown): ParseResult {
  if (!validate(value)) {
    const errors = (validate.errors ?? []).slice(0, 10).map((e) => {
      const where = e.instancePath || 'project';
      return `${where} ${e.message ?? 'is invalid'}`;
    });
    return { ok: false, errors };
  }
  const project = value as unknown as Project;
  const ids = new Set(project.nodes.map((n) => n.id));
  const errors: string[] = [];
  if (ids.size !== project.nodes.length) errors.push('Node ids are not unique.');
  for (const p of project.pipes) {
    if (!ids.has(p.from) || !ids.has(p.to)) {
      errors.push(`Pipe ${p.label} refers to a node that is not in the file.`);
    }
  }
  for (const p of project.pumps) {
    if (!ids.has(p.nodeId)) errors.push(`${p.label} refers to a node that is not in the file.`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    project: { ...project, background: project.background ?? null, baseline: project.baseline ?? null },
  };
}
