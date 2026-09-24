<?php

namespace App\Actions\Agent;

use App\Enums\PairingPurpose;
use App\Models\AuditLog;
use App\Models\Developer;
use App\Models\PairingCode;
use App\Models\User;
use App\Support\OrgClock;
use Illuminate\Support\Facades\DB;

/**
 * Issues a one-time pairing code for a developer. The plaintext is returned once and never stored or audited.
 */
class IssuePairingCode
{
    /**
     * Crockford base32 without the look-alikes 0 and 1 (Crockford already omits I, L, O and U).
     */
    private const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

    /**
     * @return string Plaintext code formatted "XXXX-XXXX".
     */
    public function handle(Developer $developer, User $by, PairingPurpose $purpose = PairingPurpose::Pair): string
    {
        return DB::transaction(function () use ($developer, $by, $purpose): string {
            do {
                $code = $this->generate();
                $hash = PairingCode::hashCode($code);
            } while (PairingCode::query()->where('code_hash', $hash)->exists());

            PairingCode::create([
                'developer_id' => $developer->id,
                'code_hash' => $hash,
                'expires_at' => OrgClock::now()->addMinutes((int) config('monitor.pairing_code_ttl_minutes')),
                'created_by_user_id' => $by->id,
                'purpose' => $purpose,
            ]);

            AuditLog::record('pairing_code.issued', $developer, ['purpose' => $purpose->value], $by);

            return $code;
        });
    }

    private function generate(): string
    {
        $characters = '';
        $max = strlen(self::ALPHABET) - 1;

        for ($i = 0; $i < 8; $i++) {
            $characters .= self::ALPHABET[random_int(0, $max)];
        }

        return substr($characters, 0, 4).'-'.substr($characters, 4);
    }
}
