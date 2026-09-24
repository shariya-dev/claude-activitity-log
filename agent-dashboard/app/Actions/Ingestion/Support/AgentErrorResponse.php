<?php

namespace App\Actions\Ingestion\Support;

use Illuminate\Http\JsonResponse;

/**
 * Builds the agent API error envelope (docs/contracts/sync-api-v1.md §9.1).
 */
final class AgentErrorResponse
{
    /**
     * @param  array<string, list<string>>|null  $errors  only for invalid_payload
     */
    public static function make(string $code, string $message, int $status, bool $retryable, ?array $errors = null): JsonResponse
    {
        $error = ['code' => $code, 'message' => $message, 'retryable' => $retryable];

        if ($errors !== null) {
            $error['errors'] = $errors;
        }

        return response()->json(['success' => false, 'error' => $error], $status);
    }

    public static function batchTooLarge(): JsonResponse
    {
        return self::make('batch_too_large', 'The batch exceeds the size limits. Split it into smaller batches.', 413, true);
    }

    /**
     * @param  array<string, list<string>>  $errors
     */
    public static function invalidPayload(array $errors): JsonResponse
    {
        return self::make('invalid_payload', 'The payload is invalid.', 422, false, $errors);
    }

    public static function agentOutdated(string $minVersion): JsonResponse
    {
        return self::make('agent_outdated', "This agent version is no longer supported. Update to {$minVersion} or later.", 426, false);
    }

    public static function batchInProgress(): JsonResponse
    {
        return self::make('batch_in_progress', 'This batch is already being processed. Retry the same batch later.', 409, true);
    }

    public static function persistenceFailed(): JsonResponse
    {
        return self::make('persistence_failed', 'The batch could not be stored. Retry later.', 500, true);
    }
}
