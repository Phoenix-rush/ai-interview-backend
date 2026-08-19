import { Request, Response, NextFunction } from 'express';
import sanitizeHtml from 'sanitize-html';

// Strips ALL HTML tags/attributes from a string — resumes, transcripts,
// names, feedback text etc. are plain text, they should never contain
// markup. This blocks stored XSS at the write path.
const clean = (value: string): string =>
  sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
  });

// Recursively walks the request body (objects + arrays) and sanitizes
// every string value in place.
const sanitizeDeep = (input: any): any => {
  if (typeof input === 'string') {
    return clean(input);
  }

  if (Array.isArray(input)) {
    return input.map(sanitizeDeep);
  }

  if (input && typeof input === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(input)) {
      result[key] = sanitizeDeep(input[key]);
    }
    return result;
  }

  return input;
};

export const sanitizeInput = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeDeep(req.body);
  }
  next();
};