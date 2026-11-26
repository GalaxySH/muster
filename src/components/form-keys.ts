/**
 * A form textarea's `onKeyDown`: Ctrl+Enter (Cmd+Enter on a Mac) saves like a
 * click on the form's submit button. Going through the button means a save
 * that is already pending (button disabled) can't be sent twice.
 */
export function submitOnCtrlEnter(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  e.currentTarget.form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
}
