/** Marks a field invalid, shows the message beside it, and moves focus there. Entered values stay as they are. */
export function focusField(id: string, message: string) {
  const field = document.getElementById(id);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
  field.setAttribute('aria-invalid', 'true');
  field.setCustomValidity(message);
  field.focus();
  field.reportValidity();
  const clear = () => {
    field.setCustomValidity('');
    field.removeAttribute('aria-invalid');
    field.removeEventListener('input', clear);
    field.removeEventListener('change', clear);
  };
  field.addEventListener('input', clear);
  field.addEventListener('change', clear);
}
