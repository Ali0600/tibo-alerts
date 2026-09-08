import { getRuntime } from '@runtime';
import { handleRequest } from '@/core/api';
async function handle(request: Request) {
  try {
    return await handleRequest(request, getRuntime());
  } catch {
    console.error('tibo_runtime_unavailable');
    return Response.json(
      { error: 'The service is temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
