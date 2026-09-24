<?php

namespace App\Actions\Agent\Support;

final class AgentVersion
{
    /**
     * Whether an agent must update before it may keep syncing. An unknown version is never outdated.
     */
    public static function isOutdated(?string $agentVersion, string $minAgentVersion): bool
    {
        if ($agentVersion === null || $agentVersion === '') {
            return false;
        }

        return version_compare($agentVersion, $minAgentVersion, '<');
    }
}
