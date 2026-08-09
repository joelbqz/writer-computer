interface RunCreateRequestOptions<TResult> {
  create: () => Promise<TResult>;
  isCurrent: () => boolean;
  onCreated: (result: TResult) => void;
  onCreationError: (error: unknown) => void;
}

/**
 * Complete one palette creation request only if its opening session is still
 * current. A dismissed-and-reopened palette belongs to a new session and must
 * not be closed or receive errors from an older IPC request.
 */
export async function runCreateRequest<TResult>({
  create,
  isCurrent,
  onCreated,
  onCreationError,
}: RunCreateRequestOptions<TResult>): Promise<void> {
  try {
    const result = await create();
    if (isCurrent()) onCreated(result);
  } catch (error) {
    if (isCurrent()) onCreationError(error);
  }
}
