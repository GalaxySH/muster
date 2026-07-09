/**
 * Deep-link helpers for one change request (roadmap 3.1): the admin
 * per-student page anchors each request as `#change-request-<id>`, and the
 * queue page + digest email link straight to it. Pure (the email builder
 * prefixes the base URL).
 */
export const changeRequestAnchor = (id: string) => `change-request-${id}`;

export const changeRequestAdminPath = (studentEmail: string, id: string) =>
  `/admin/students/${encodeURIComponent(studentEmail)}#${changeRequestAnchor(id)}`;
