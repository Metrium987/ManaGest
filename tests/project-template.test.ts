import { describe, expect, it } from 'vitest';
import { nextVersion, normaliseTemplateTasks, templateEstimateMinutes } from '../shared/project-template';

describe('project template tasks', () => {
  it('trims titles and drops a task without a title', () => {
    const tasks = normaliseTemplateTasks([
      { title: '  Cadrage  ' },
      { title: '   ' },
      { title: 'Recette', minutes: 90 },
    ]);
    expect(tasks.map((task) => task.title)).toEqual(['Cadrage', 'Recette']);
    expect(tasks.map((task) => task.sort_order)).toEqual([0, 1]);
  });

  it('clamps the numbers instead of storing anything the platform refuses', () => {
    const [task] = normaliseTemplateTasks([{ title: 'X', minutes: -5, hourly_rate: 99_999_999 }]);
    expect(task.minutes).toBe(0);
    expect(task.hourly_rate).toBe(9_999_999);
  });

  it('keeps billable by default and an empty description as null', () => {
    const [task] = normaliseTemplateTasks([{ title: 'X', description: '   ' }]);
    expect(task.billable).toBe(true);
    expect(task.description).toBeNull();
  });

  it('adds up the estimate', () => {
    expect(templateEstimateMinutes([{ minutes: 60 }, { minutes: 90 }, {}])).toBe(150);
  });
});

describe('versions', () => {
  it('starts at 1 and only grows', () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([1])).toBe(2);
    expect(nextVersion([1, 3, 2])).toBe(4);
  });
});
