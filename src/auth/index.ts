export { AuthProvider, useAuth } from './AuthProvider';
export {
  roleForProject,
  isSuperOnAnyProject,
  isCompanyAdmin,
  isProfileComplete,
  validateCredentials,
} from './roles';
export { registerCompany } from './registration';
export type { RegisterCompanyRequest, RegisterCompanyResult } from './registration';
export { validateRegistration, isValidEmail, NAME_MAX, EMAIL_MAX } from './registrationValidation';
export type { RegisterInput, RegisterField, FieldErrors } from './registrationValidation';
export { parseAuthLink, LINK_PROBLEM_MESSAGE } from './authLink';
export type { AuthLinkType, AuthLinkResult } from './authLink';
export { checkPasswordStrength, MIN_PASSWORD_LENGTH, MIN_PASSWORD_SCORE } from './passwordStrength';
export type { PasswordStrength } from './passwordStrength';
export { validatePasswordChoice } from './passwordChoice';
export type { PasswordChoiceResult } from './passwordChoice';
export { stashAuthFragment, takeAuthFragment } from './pendingAuthLink';
export { planConfirmLanding } from './confirmLanding';
export type { ConfirmLandingAction } from './confirmLanding';
export { applyAuthTokens, updateAuthPassword } from './setPasswordSession';
export type {
  ApplyAuthTokensResult,
  PendingMutationCount,
  UpdatePasswordResult,
} from './setPasswordSession';
