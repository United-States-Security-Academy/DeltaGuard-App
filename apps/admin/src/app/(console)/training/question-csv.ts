// Questions <-> CSV (plain module). One question per row:
//
//   type, prompt, option_1 ... option_6, correct, explanation, points
//
//   type     single_choice | multiple_choice | true_false
//            (also: single, multiple, true/false, tf)
//   correct  the numbers of the correct options, separated by ; or space
//            (e.g. "2" or "1;3"). For true/false: true or false (options may
//            be left empty: they become True and False).
//   points   optional, default 1

import { type QuestionInput, questionSchema, type QuestionType } from '@deltaguard/shared';

import { parseCsv, toCsv } from '@/lib/csv';

export const QUESTION_CSV_HEADER = [
  'type',
  'prompt',
  'option_1',
  'option_2',
  'option_3',
  'option_4',
  'option_5',
  'option_6',
  'correct',
  'explanation',
  'points',
];

export function questionTemplateCsv(): string {
  return toCsv([
    QUESTION_CSV_HEADER,
    [
      'single_choice',
      'Who do you call first when you find an open door after hours?',
      'The client',
      'Your supervisor',
      'The police',
      '',
      '',
      '',
      '2',
      'Your supervisor decides who else to call.',
      '1',
    ],
    [
      'multiple_choice',
      'What goes in the daily activity report?',
      'Patrol times',
      'Visitors',
      'Personal opinions',
      'Incidents',
      '',
      '',
      '1;2;4',
      '',
      '2',
    ],
    [
      'true_false',
      'You may leave your post before your relief arrives.',
      '',
      '',
      '',
      '',
      '',
      '',
      'false',
      '',
      '1',
    ],
  ]);
}

const TYPE_ALIASES: Record<string, QuestionType> = {
  single_choice: 'single_choice',
  single: 'single_choice',
  one: 'single_choice',
  multiple_choice: 'multiple_choice',
  multiple: 'multiple_choice',
  many: 'multiple_choice',
  true_false: 'true_false',
  'true/false': 'true_false',
  truefalse: 'true_false',
  tf: 'true_false',
};

export type CsvParseResult = {
  questions: QuestionInput[];
  errors: string[];
};

export function parseQuestionCsv(text: string): CsvParseResult {
  const rows = parseCsv(text);
  const errors: string[] = [];
  const questions: QuestionInput[] = [];
  if (rows.length === 0) return { questions, errors: ['The file is empty.'] };

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const hasHeader = header[0] === 'type';
  const col = (name: string) =>
    hasHeader ? header.indexOf(name) : QUESTION_CSV_HEADER.indexOf(name);
  const body = hasHeader ? rows.slice(1) : rows;

  body.forEach((row, index) => {
    const line = index + (hasHeader ? 2 : 1);
    const get = (name: string) => {
      const i = col(name);
      return i >= 0 ? (row[i] ?? '').trim() : '';
    };
    const type = TYPE_ALIASES[get('type').toLowerCase().replace(/\s+/g, '')];
    if (!type) {
      errors.push(`Row ${line}: unknown type "${get('type')}".`);
      return;
    }
    let texts = [1, 2, 3, 4, 5, 6].map((n) => get(`option_${n}`));
    const correctCell = get('correct').toLowerCase();
    let correct: number[];
    if (type === 'true_false') {
      if (texts.every((t) => t === '')) texts = ['True', 'False'];
      correct =
        correctCell === 'true' || correctCell === 't' || correctCell === '1'
          ? [1]
          : correctCell === 'false' || correctCell === 'f' || correctCell === '2'
            ? [2]
            : [];
    } else {
      correct = correctCell
        .split(/[;\s,]+/)
        .filter(Boolean)
        .map(Number);
    }
    // Keep option numbering: empty options in the middle are dropped after mapping.
    const options = texts
      .map((text, i) => ({ text, is_correct: correct.includes(i + 1) }))
      .filter((o) => o.text !== '');
    if (correct.some((n) => !Number.isInteger(n) || n < 1 || n > 6 || texts[n - 1] === '')) {
      errors.push(`Row ${line}: "correct" points to an option that is empty or doesn't exist.`);
      return;
    }
    const pointsCell = get('points');
    const parsed = questionSchema.safeParse({
      type,
      prompt: get('prompt'),
      explanation: get('explanation'),
      points: pointsCell === '' ? 1 : Number(pointsCell),
      options,
    });
    if (!parsed.success) {
      errors.push(`Row ${line}: ${parsed.error.issues[0]?.message ?? 'invalid question'}.`);
      return;
    }
    questions.push(parsed.data);
  });

  if (questions.length === 0 && errors.length === 0) errors.push('No questions found in the file.');
  return { questions, errors };
}
