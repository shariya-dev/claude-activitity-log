<?php

namespace App\Actions\Agent\Support;

final class AgentVersion
{
    /**
     * Contract semver (sync-api-v1 §3.1), max 32 chars.
     */
    public const PATTERN = '/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/';

    public static function isValid(?string $agentVersion): bool
    {
        return $agentVersion !== null && strlen($agentVersion) <= 32 && preg_match(self::PATTERN, $agentVersion) === 1;
    }

    /**
     * Whether an agent must update before it may keep syncing. A missing or malformed version is never outdated.
     */
    public static function isOutdated(?string $agentVersion, string $minAgentVersion): bool
    {
        if (! self::isValid($agentVersion)) {
            return false;
        }

        return version_compare($agentVersion, $minAgentVersion, '<');
    }
}
