import { body, param, query, header, validationResult, matchedData } from 'express-validator';
import { AppError } from '../utils/errors.js';

const optionalText = field => body(field).optional({ nullable: true }).isString().bail().trim();
const active = required => {
  const rule = body('is_active');
  return (required ? rule : rule.optional()).custom(value => typeof value === 'boolean').withMessage('Must be true or false.');
};
export const memberRules = [
  body('name').isString().bail().trim().isLength({ min: 1, max: 150 }).withMessage('Name must contain 1–150 characters.')
    .matches(/^[^\x00-\x1F\x7F]+$/u).withMessage('Name cannot contain control characters.'),
  optionalText('member_code').isLength({ max: 50 }).withMessage('Member code must be at most 50 characters.')
    .custom(value => value === '' || /^[A-Za-z0-9._-]+$/.test(value)).withMessage('Use letters, numbers, dots, hyphens or underscores.'),
  optionalText('email').isLength({ max: 255 }).bail().if(value => value !== '').isEmail().withMessage('Enter a valid email address.'),
  active(false)
];
export const idRules = [param('id').matches(/^[1-9]\d{0,18}$/).bail()
  .custom(value => BigInt(value) <= 9223372036854775807n).withMessage('Invalid participant ID.')];
export const statusRules = [active(true)];
export const loginRules = [
  body('username').isString().bail().trim().isLength({ min: 1, max: 80 }),
  body('password').isString().bail().isLength({ min: 1, max: 256 })
];
export const passwordRules = [
  body('current_password').isString().bail().isLength({ min: 1, max: 256 }),
  body('new_password').isString().bail().isLength({ min: 12, max: 256 }).withMessage('Use a new password containing 12–256 characters.'),
  body('confirm_password').custom((value, { req }) => typeof value === 'string' && value === req.body.new_password).withMessage('The new passwords do not match.')
];
export const spinRules = [header('Idempotency-Key').matches(/^[a-zA-Z0-9_-]{16,64}$/).withMessage('A 16–64 character Idempotency-Key is required.')];
export const historyRules = [
  query('scope').optional().isIn(['current', 'all']),
  query('month').optional().isInt({ min: 1, max: 12 }).toInt(),
  query('year').optional().isInt({ min: 2000, max: 9999 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0, max: 1000000 }).toInt(),
  query().custom(value => Boolean(value.month) === Boolean(value.year)).withMessage('Supply month and year together.'),
  query().custom(value => value.scope !== 'all' || (!value.month && !value.year)).withMessage('Choose all history or a specific month.')
];
export function onlyBodyKeys(keys) {
  return (req, res, next) => {
    if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object' || Object.keys(req.body).some(key => !keys.includes(key))) {
      return next(new AppError(422, 'INVALID_BODY', keys.length ? 'The request contains unsupported fields.' : 'The draw request body must be an empty object.'));
    }
    next();
  };
}
export function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return next(new AppError(422, 'VALIDATION_ERROR', 'Please check the supplied information.',
    errors.array().map(error => ({ field: error.path || 'query', message: error.msg }))));
  req.validated = matchedData(req, { locations: ['body', 'query', 'params'] });
  next();
}
export function memberData(req) {
  const { name, member_code, email, is_active } = req.validated;
  return { name, member_code: member_code || null, email: email || null, is_active: is_active ?? true };
}
