import { isContentType, resolveAllowedType } from "./constants.js";

export function isEmptyAnswer(type, value) {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim() === "";
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (type === "FILE") {
    return typeof value !== "object" || typeof value.path !== "string" || !value.path;
  }

  if (typeof value === "number") {
    return Number.isNaN(value);
  }

  return false;
}

function rulesOf(field) {
  return field.validation && typeof field.validation === "object" ? field.validation : {};
}

function invalid(field, message) {
  return { error: message, fieldId: field.id };
}

export function validateAnswer(field, value) {
  if (isContentType(field.type)) {
    return null;
  }

  const empty = isEmptyAnswer(field.type, value);
  if (field.required && empty) {
    return invalid(field, `"${field.label}" is required.`);
  }

  if (empty) {
    return null;
  }

  const rules = rulesOf(field);

  switch (field.type) {
    case "TEXT":
    case "TEXTAREA":
    case "EMAIL":
    case "PHONE": {
      if (typeof value !== "string") {
        return invalid(field, `"${field.label}" must be text.`);
      }

      const text = value.trim();
      if (field.type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        return invalid(field, `"${field.label}" must be a valid email address.`);
      }

      if (field.type === "PHONE" && !/^\+?[0-9]{9,15}$/.test(text)) {
        return invalid(field, `"${field.label}" must be 9–15 digits with an optional leading +.`);
      }

      if ((field.type === "TEXT" || field.type === "TEXTAREA") && rules.minLength != null && text.length < rules.minLength) {
        return invalid(field, `"${field.label}" must be at least ${rules.minLength} characters.`);
      }

      if ((field.type === "TEXT" || field.type === "TEXTAREA") && rules.maxLength != null && text.length > rules.maxLength) {
        return invalid(field, `"${field.label}" must be at most ${rules.maxLength} characters.`);
      }

      return null;
    }
    case "NUMBER":
    case "RATING":
    case "LINEAR_SCALE": {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number)) {
        return invalid(field, `"${field.label}" must be a number.`);
      }

      if (field.type === "RATING") {
        const max = rules.max ?? 5;
        if (!Number.isInteger(number) || number < 1 || number > max) {
          return invalid(field, `"${field.label}" must be a whole number from 1 to ${max}.`);
        }
      }

      if (field.type === "LINEAR_SCALE") {
        const min = rules.min ?? 1;
        const max = rules.max ?? 5;
        if (!Number.isInteger(number) || number < min || number > max) {
          return invalid(field, `"${field.label}" must be a whole number from ${min} to ${max}.`);
        }
      }

      if (field.type === "NUMBER" && rules.min != null && number < rules.min) {
        return invalid(field, `"${field.label}" must be at least ${rules.min}.`);
      }

      if (field.type === "NUMBER" && rules.max != null && number > rules.max) {
        return invalid(field, `"${field.label}" must be at most ${rules.max}.`);
      }

      return null;
    }
    case "DATE": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
        return invalid(field, `"${field.label}" must be a valid date.`);
      }

      return null;
    }
    case "YES_NO": {
      if (typeof value !== "boolean") {
        return invalid(field, `"${field.label}" must be yes or no.`);
      }

      return null;
    }
    case "RADIO":
    case "SELECT": {
      if (typeof value !== "string" || !field.options.some((option) => option.id === value)) {
        return invalid(field, `"${field.label}" has an invalid choice.`);
      }

      return null;
    }
    case "CHECKBOX": {
      if (
        !Array.isArray(value) ||
        value.some((optionId) => typeof optionId !== "string" || !field.options.some((option) => option.id === optionId))
      ) {
        return invalid(field, `"${field.label}" has an invalid choice.`);
      }

      return null;
    }
    case "FILE": {
      if (!value || typeof value !== "object" || typeof value.path !== "string" || typeof value.fileName !== "string") {
        return invalid(field, `"${field.label}" needs a file.`);
      }

      const allowed = Array.isArray(rules.allowedMimeTypes) ? rules.allowedMimeTypes : [];
      if (!resolveAllowedType(value.mimeType, value.fileName, allowed)) {
        return invalid(field, `"${field.label}" file type is not allowed.`);
      }

      const maxMb = rules.maxFileSizeMb ?? 10;
      if (typeof value.size === "number" && value.size > maxMb * 1024 * 1024) {
        return invalid(field, `"${field.label}" must be ${maxMb} MB or smaller.`);
      }

      return null;
    }
    default:
      return invalid(field, `"${field.label}" has an unsupported type.`);
  }
}

export function normalizeStoredAnswer(field, value) {
  switch (field.type) {
    case "TEXT":
    case "TEXTAREA":
    case "EMAIL":
    case "PHONE":
    case "DATE":
      return typeof value === "string" ? value.trim() : value;
    case "NUMBER":
    case "RATING":
    case "LINEAR_SCALE":
      return typeof value === "number" ? value : Number(value);
    case "CHECKBOX":
      return [...new Set(value)];
    case "FILE":
      return {
        path: value.path,
        fileName: value.fileName,
        mimeType: typeof value.mimeType === "string" ? value.mimeType : "",
        size: typeof value.size === "number" ? value.size : 0,
      };
    default:
      return value;
  }
}
