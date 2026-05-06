import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, type QuickReplyCategory } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../stores/toast.store';
import { useDebounce } from '../../hooks/useDebounce';
import { PageShell } from '../../components/layout/PageShell';

const CATEGORY_ORDER: QuickReplyCategory[] = [
  'greeting',
  'service',
  'commercial',
  'closing',
  'support',
  'other',
];

const EMPTY_FORM: QuickReplyFormState = {
  title: '',
  shortcut: '',
  content: '',
  category: 'other',
};

const QUICK_REPLY_VARIABLES = [
  '{{nome}}',
  '{{empresa}}',
  '{{protocolo}}',
  '{{agente}}',
  '{{data}}',
  '{{hora}}',
] as const;

interface QuickReplyFormState {
  title: string;
  shortcut: string;
  content: string;
  category: QuickReplyCategory;
}

function sanitizeShortcut(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^\/+/, '')
    .replace(/[^a-z0-9_-]/g, '');
}

export function QuickReplies() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<QuickReplyFormState>(EMPTY_FORM);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const debouncedSearch = useDebounce(search, 250);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'quick-replies', debouncedSearch],
    queryFn: () => adminApi.quickReplies.list(debouncedSearch ? { search: debouncedSearch } : undefined),
  });

  const replies = data ?? [];
  const selectedReply = useMemo(
    () => replies.find((reply) => reply.id === selectedId) ?? null,
    [replies, selectedId],
  );

  useEffect(() => {
    if (selectedReply) {
      setForm({
        title: selectedReply.title,
        shortcut: selectedReply.shortcut,
        content: selectedReply.content,
        category: selectedReply.category,
      });
      return;
    }

    if (!selectedId) {
      setForm(EMPTY_FORM);
    }
  }, [selectedId, selectedReply]);

  const createMutation = useMutation({
    mutationFn: (payload: QuickReplyFormState) => adminApi.quickReplies.create(payload),
    onSuccess: async (created) => {
      toast.success(t('tenantAdmin.quickReplies.messages.created'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'quick-replies'] });
      setSelectedId(created.id);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(error.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string; data: QuickReplyFormState }) =>
      adminApi.quickReplies.update(payload.id, payload.data),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.quickReplies.messages.updated'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'quick-replies'] });
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(error.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.quickReplies.delete(id),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.quickReplies.messages.deleted'));
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'quick-replies'] });
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(error.response?.data?.error?.message ?? t('tenantAdmin.common.errorSave'));
    },
  });

  function startNewReply() {
    setSelectedId(null);
    setForm(EMPTY_FORM);
  }

  function insertVariable(variable: string) {
    const textarea = contentTextareaRef.current;
    if (!textarea) {
      setForm((prev) => ({ ...prev, content: `${prev.content}${variable}` }));
      return;
    }

    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;

    setForm((prev) => ({
      ...prev,
      content: `${prev.content.slice(0, start)}${variable}${prev.content.slice(end)}`,
    }));

    window.requestAnimationFrame(() => {
      const node = contentTextareaRef.current;
      if (!node) return;
      const nextCursor = start + variable.length;
      node.focus();
      node.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function handleSubmit() {
    const payload: QuickReplyFormState = {
      title: form.title.trim(),
      shortcut: sanitizeShortcut(form.shortcut),
      content: form.content.trim(),
      category: form.category,
    };

    if (!payload.title || !payload.shortcut || !payload.content) {
      toast.error(t('tenantAdmin.common.errorSave'));
      return;
    }

    if (selectedId) {
      updateMutation.mutate({ id: selectedId, data: payload });
      return;
    }

    createMutation.mutate(payload);
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isDirty =
    !selectedReply ||
    selectedReply.title !== form.title ||
    selectedReply.shortcut !== form.shortcut ||
    selectedReply.content !== form.content ||
    selectedReply.category !== form.category;

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div className="flex h-full flex-col gap-5 p-6" style={{ overflow: 'hidden' }}>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--txt)' }}>
            {t('tenantAdmin.quickReplies.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.quickReplies.subtitle')}
          </p>
        </div>

        <Button onClick={startNewReply}>
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {t('tenantAdmin.quickReplies.new')}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section
          className="flex min-h-0 flex-col overflow-hidden rounded-xl"
          style={{ border: '1px solid var(--line)', background: 'var(--bg-2)' }}
        >
          <div className="border-b p-4" style={{ borderColor: 'var(--line)' }}>
            <Input
              placeholder={t('tenantAdmin.quickReplies.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-20 animate-pulse rounded-xl bg-bg-3" />
                ))}
              </div>
            ) : replies.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
                  {t('tenantAdmin.quickReplies.noReplies')}
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--txt-3)' }}>
                  {t('tenantAdmin.quickReplies.noRepliesHint')}
                </p>
              </div>
            ) : (
              <div className="flex flex-col">
                {replies.map((reply) => {
                  const isActive = reply.id === selectedId;
                  return (
                    <button
                      key={reply.id}
                      type="button"
                      onClick={() => setSelectedId(reply.id)}
                      className="border-b px-4 py-4 text-left transition-colors"
                      style={{
                        borderColor: 'var(--line)',
                        background: isActive ? 'rgba(0,201,167,.08)' : 'transparent',
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              style={{
                                fontFamily: 'var(--mono)',
                                fontSize: 12,
                                fontWeight: 600,
                                color: 'var(--teal)',
                                background: 'var(--teal-dim)',
                                borderRadius: 999,
                                padding: '2px 8px',
                              }}
                            >
                              /{reply.shortcut}
                            </span>
                            <span className="truncate text-sm font-medium" style={{ color: 'var(--txt)' }}>
                              {reply.title}
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-xs" style={{ color: 'var(--txt-3)' }}>
                            {reply.content}
                          </p>
                        </div>
                        <span
                          className="shrink-0 rounded-full px-2 py-1 text-[11px]"
                          style={{ background: 'var(--bg-4)', color: 'var(--txt-2)' }}
                        >
                          {t(`tenantAdmin.quickReplies.categories.${reply.category}`)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section
          className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]"
        >
          <div
            className="min-h-0 rounded-xl p-5"
            style={{ border: '1px solid var(--line)', background: 'var(--bg-2)' }}
          >
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
                    {t('tenantAdmin.quickReplies.title_field')}
                  </span>
                  <Input
                    value={form.title}
                    onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
                    {t('tenantAdmin.quickReplies.shortcut')}
                  </span>
                  <Input
                    value={form.shortcut}
                    placeholder={t('tenantAdmin.quickReplies.shortcutPlaceholder')}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, shortcut: sanitizeShortcut(event.target.value) }))
                    }
                  />
                  <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                    {t('tenantAdmin.quickReplies.shortcutHelper', {
                      shortcut: form.shortcut || t('tenantAdmin.quickReplies.shortcutPlaceholder'),
                    })}
                  </span>
                </label>
              </div>

              <label className="grid gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
                  {t('tenantAdmin.quickReplies.category')}
                </span>
                <select
                  value={form.category}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, category: event.target.value as QuickReplyCategory }))
                  }
                  style={{
                    height: 40,
                    borderRadius: 10,
                    border: '1px solid var(--line)',
                    background: 'var(--bg-3)',
                    color: 'var(--txt)',
                    padding: '0 12px',
                    fontSize: 13,
                    outline: 'none',
                  }}
                >
                  {CATEGORY_ORDER.map((category) => (
                    <option key={category} value={category}>
                      {t(`tenantAdmin.quickReplies.categories.${category}`)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
                  {t('tenantAdmin.quickReplies.content')}
                </span>
                <textarea
                  ref={contentTextareaRef}
                  rows={10}
                  value={form.content}
                  placeholder={t('tenantAdmin.quickReplies.contentPlaceholder')}
                  onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
                  style={{
                    width: '100%',
                    resize: 'vertical',
                    minHeight: 220,
                    borderRadius: 12,
                    border: '1px solid var(--line)',
                    background: 'var(--bg-3)',
                    color: 'var(--txt)',
                    padding: '12px 14px',
                    fontSize: 13,
                    lineHeight: 1.5,
                    outline: 'none',
                  }}
                />
                <div className="variables-hint">
                  <span>Variáveis disponíveis:</span>
                  {QUICK_REPLY_VARIABLES.map((variable) => (
                    <button
                      key={variable}
                      type="button"
                      onClick={() => insertVariable(variable)}
                      className="var-chip"
                    >
                      {variable}
                    </button>
                  ))}
                </div>
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleSubmit} disabled={isSubmitting || !isDirty}>
                  {selectedId ? t('tenantAdmin.common.save') : t('tenantAdmin.quickReplies.new')}
                </Button>

                {selectedId ? (
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(selectedId)}
                    disabled={deleteMutation.isPending}
                    className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    style={{
                      border: '1px solid rgba(248,113,113,.2)',
                      background: 'var(--red-dim)',
                      color: 'var(--red)',
                    }}
                  >
                    {t('tenantAdmin.common.remove')}
                  </button>
                ) : null}

                {selectedId ? (
                  <button
                    type="button"
                    onClick={startNewReply}
                    className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    style={{
                      border: '1px solid var(--line)',
                      background: 'var(--bg-3)',
                      color: 'var(--txt-2)',
                    }}
                  >
                    {t('tenantAdmin.common.cancel')}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <aside
            className="rounded-xl p-5"
            style={{ border: '1px solid var(--line)', background: 'var(--bg-2)' }}
          >
            <h2 className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
              {t('tenantAdmin.quickReplies.preview')}
            </h2>

            <div
              className="mt-4 rounded-2xl p-4"
              style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}
            >
              <div className="mb-3 flex items-center gap-2">
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--teal)',
                    background: 'var(--teal-dim)',
                    borderRadius: 999,
                    padding: '2px 8px',
                  }}
                >
                  /{form.shortcut || 'atalho'}
                </span>
                <span className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
                  {form.title || '—'}
                </span>
              </div>

              <div
                className="rounded-2xl rounded-br-md px-4 py-3 text-sm"
                style={{ background: 'var(--teal)', color: '#0E1A18' }}
              >
                {form.content || t('tenantAdmin.quickReplies.contentPlaceholder')}
              </div>
            </div>
          </aside>
        </section>
      </div>
      </div>
    </PageShell>
  );
}
