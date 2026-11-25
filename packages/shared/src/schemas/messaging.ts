import { z } from 'zod';

import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_TYPES,
  CHAT_MESSAGE_MAX_LENGTH,
} from '../constants';

// Mirrors public.messages and the messaging functions' arguments. The database
// re-checks everything (membership, folders, roles).

/** A message: text, a photo, or both. */
export const sendMessageSchema = z
  .object({
    id: z.uuid(),
    conversation_id: z.uuid(),
    body: z
      .string()
      .trim()
      .max(CHAT_MESSAGE_MAX_LENGTH, `At most ${CHAT_MESSAGE_MAX_LENGTH} characters`)
      .transform((v) => (v === '' ? null : v))
      .nullable(),
    attachment_path: z.string().max(300).nullable(),
  })
  .refine((m) => m.body !== null || m.attachment_path !== null, {
    message: 'Write a message or add a photo',
    path: ['body'],
  });
export type SendMessageInput = z.input<typeof sendMessageSchema>;

/** Admins and supervisors: a new group. */
export const createGroupSchema = z.object({
  p_name: z.string().trim().min(1, 'Give the group a name').max(100, 'At most 100 characters'),
  p_member_ids: z.array(z.uuid()).max(500),
  p_site_id: z.uuid().nullable(),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const addMembersSchema = z.object({
  p_conversation_id: z.uuid(),
  p_user_ids: z.array(z.uuid()).min(1, 'Choose someone to add').max(500),
});

/** A picked image, checked before upload. */
export const chatAttachmentFileSchema = z.object({
  type: z.enum(CHAT_ATTACHMENT_TYPES, 'Choose a JPEG, PNG or WebP image'),
  size: z.number().max(CHAT_ATTACHMENT_MAX_BYTES, 'The image is too large (10 MB max)'),
});
