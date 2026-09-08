export function registerAlertTools(configure: (timezone: string) => void) {
  const context = (
    document as unknown as {
      modelContext?: {
        registerTool: (
          tool: Record<string, unknown>,
          options: { signal: AbortSignal },
        ) => unknown;
      };
    }
  ).modelContext;
  if (!context?.registerTool) return () => {};
  const controller = new AbortController();
  try {
    Promise.resolve(
      context.registerTool(
        {
          name: 'set_display_timezone',
          title: 'Set alert display timezone',
          description:
            'Change the visible timezone for reset times and stage it in the signup form. Does not subscribe or change saved preferences.',
          inputSchema: {
            type: 'object',
            properties: { timezone: { type: 'string' } },
            required: ['timezone'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input: unknown) {
            const timezone = (input as { timezone?: unknown })?.timezone;
            if (
              typeof timezone !== 'string' ||
              timezone.length > 80 ||
              !/^(?:UTC|GMT|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/.test(timezone)
            )
              throw new Error('Invalid timezone');
            new Intl.DateTimeFormat('en', { timeZone: timezone });
            configure(timezone);
            return { timezone, subscriptionChanged: false };
          },
        },
        { signal: controller.signal },
      ),
    ).catch(() => {});
  } catch {}
  return () => controller.abort();
}
