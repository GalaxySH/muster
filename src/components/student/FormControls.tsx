"use client";

/**
 * The student form's client-side controls: the ones that need a hook.
 */
import { useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCloudArrowUp } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import { Button } from "./ui";

/**
 * Submit button for a `<form action={serverAction}>`: it reads the form's
 * pending state, so a server page gets the disabled, relabelled button without
 * becoming a client component.
 */
export function FormSubmitButton({
  pendingLabel,
  ...rest
}: Omit<React.ComponentProps<typeof Button>, "type" | "pending">) {
  const { pending } = useFormStatus();
  return <Button {...rest} type="submit" pending={pending} pendingLabel={pendingLabel} />;
}

function fileNames(input: HTMLInputElement): string {
  return Array.from(input.files ?? [], (f) => f.name).join(", ");
}

/**
 * A file input drawn as a large tap tile. The native input covers the tile, so
 * tapping, keyboard use, drag and drop and `form.reset()` all behave as the
 * browser's own control does. The tile shows the chosen file's name.
 */
export function FilePicker({
  name = "file",
  label,
  hint,
  accept,
  required,
  multiple,
  disabled,
  disabledReason,
  inputRef,
}: {
  name?: string;
  /** The visible prompt, and the input's accessible name. */
  label: string;
  /** The accepted formats, shown under the prompt. */
  hint?: string;
  accept?: string;
  required?: boolean;
  multiple?: boolean;
  disabled?: boolean;
  /** Shown in place of the hint while disabled. */
  disabledReason?: string;
  /** For a caller that reads the chosen files itself instead of posting the form. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const hintId = useId();
  const [chosen, setChosen] = useState("");
  const detail = disabled ? (disabledReason ?? hint) : hint;
  return (
    <label className={disabled ? "sf-file sf-file--disabled" : "sf-file"}>
      <FontAwesomeIcon icon={faCloudArrowUp} className="sf-file-icon" aria-hidden />
      <span className="sf-file-text">
        <span className="sf-file-title">{chosen || label}</span>
        {detail && (
          <span id={hintId} className="sf-hint">
            {chosen ? `Tap to choose a different file. ${detail}` : detail}
          </span>
        )}
      </span>
      <input
        type="file"
        name={name}
        accept={accept}
        required={required}
        multiple={multiple}
        disabled={disabled}
        aria-label={label}
        aria-describedby={detail ? hintId : undefined}
        onChange={(e) => setChosen(fileNames(e.target))}
        ref={(el) => {
          if (!el) return;
          if (inputRef) inputRef.current = el;
          // A browser can restore a chosen file on reload without firing change.
          setChosen(fileNames(el));
          // form.reset() clears the input without firing change either, so the
          // tile would keep showing the old name.
          const form = el.form;
          const clear = () => setChosen("");
          form?.addEventListener("reset", clear);
          return () => {
            form?.removeEventListener("reset", clear);
            if (inputRef) inputRef.current = null;
          };
        }}
      />
    </label>
  );
}
