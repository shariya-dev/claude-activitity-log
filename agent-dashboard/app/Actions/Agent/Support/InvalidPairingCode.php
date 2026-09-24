<?php

namespace App\Actions\Agent\Support;

use RuntimeException;

/**
 * Thrown for any unusable pairing code (unknown, expired, used, inactive developer).
 * Deliberately carries no detail about which check failed.
 */
final class InvalidPairingCode extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('The pairing code is invalid or has expired.');
    }
}
