/**
 * Deep-link helpers for one change request (roadmap 3.1): the admin
 * per-student page anchors each request as `#change-request-<id>`, and the
 * queue page + digest email link straight to it. Pure (the email builder
 * prefixes the base URL).
 */
export const changeRequestAnchor = (id: string) => `change-request-${id}`;

/**
 * The request id also rides as `?request=`, since the anchor never reaches the
 * server: the page uses it to say which semester a request is in when it is
 * not the one selected.
 */
export const changeRequestAdminPath = (studentEmail: string, id: string) =>
  `/admin/students/${encodeURIComponent(studentEmail)}?request=${encodeURIComponent(id)}#${changeRequestAnchor(id)}`;
