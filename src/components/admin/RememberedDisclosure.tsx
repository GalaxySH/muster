"use client";

/**
 * A `Disclosure` whose open or closed state is the admin's own preference: the
 * server renders it the way they left it, and each toggle is saved to their
 * account. For a card on a student's page that some admins keep open and
 * others closed.
 */
import { useRef } from "react";
import { Disclosure } from "@/components/admin/ui";
import { saveCardFolded } from "@/lib/admin/preferences-actions";

export function RememberedDisclosure({
  cardId,
  open,
  ...rest
}: {
  /** The id it is remembered under (see FOLDABLE_CARDS). */
  cardId: string;
  open: boolean;
  title: React.ReactNode;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  // React's first toggle event can report the state it rendered with; only a
  // real change is worth a save.
  const last = useRef(open);
  return (
    <Disclosure
      {...rest}
      open={open}
      onToggle={(next) => {
        if (next === last.current) return;
        last.current = next;
        void saveCardFolded(cardId, !next).catch(() => {});
      }}
    />
  );
}
