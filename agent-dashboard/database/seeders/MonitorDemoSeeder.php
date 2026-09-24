<?php

namespace Database\Seeders;

use App\Actions\Ingestion\IngestSyncBatch;
use App\Enums\DeveloperStatus;
use App\Enums\DeviceStatus;
use App\Enums\TrackingCategory;
use App\Enums\UserRole;
use App\Models\Developer;
use App\Models\Device;
use App\Models\TrackingSetting;
use App\Models\User;
use App\Support\OrgClock;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Random\Engine\Mt19937;
use Random\Randomizer;

/**
 * Demo data produced through the real ingestion path: this seeder behaves like a set of agents,
 * building contract-shaped sync payloads (docs/contracts/sync-api-v1.md §3.4, §4) and handing them
 * to IngestSyncBatch. Everything is derived from fixed seeds, and batch ids are content-addressed,
 * so re-running replays identical batches instead of duplicating data.
 *
 * Project keys follow D13 as a real agent would: sha256(normalized_remote) when Git is ON,
 * otherwise sha256(device_uid + "\n" + absolute_cwd), so with Git OFF each device has its own key.
 *
 * @phpstan-type Record array<string, mixed>
 * @phpstan-type DemoSession array{project: int, first: CarbonImmutable, last: CarbonImmutable, record: Record, usage: list<Record>, messages: list<Record>}
 * @phpstan-type DeviceSpec array{developer: int, platform: string, platform_version: string, architecture: string, user: string, host: string, primary: bool, last_seen_minutes: int}
 */
class MonitorDemoSeeder extends Seeder
{
    private const string SEED = '6am-monitor-demo';

    private const int HISTORY_DAYS = 60;

    private const string AGENT_VERSION = '1.0.0';

    private const string ORGANIZATION_UUID = '3e7f1c90-2b4a-4d6e-8f15-7a9c0b3d5e21';

    private const string ORGANIZATION_NAME = 'Example Org';

    private const string CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    /** @var array<string, int> */
    private const array LIMITS = ['sessions' => 200, 'usage' => 500, 'messages' => 200];

    /** @var list<array{name: string, email: string, team: string, account: int, projects: list<int>}> */
    private const array DEVELOPERS = [
        ['name' => 'Ayesha Rahman', 'email' => 'ayesha.rahman@example.com', 'team' => 'Backend', 'account' => 0, 'projects' => [0, 2, 1]],
        ['name' => 'Tanvir Hasan', 'email' => 'tanvir.hasan@example.com', 'team' => 'Backend', 'account' => 0, 'projects' => [2, 0, 6]],
        ['name' => 'Nusrat Jahan', 'email' => 'nusrat.jahan@example.com', 'team' => 'Frontend', 'account' => 1, 'projects' => [1, 3, 4]],
        ['name' => 'Rafiul Islam', 'email' => 'rafiul.islam@example.com', 'team' => 'Mobile', 'account' => 1, 'projects' => [5, 4, 3]],
        ['name' => 'Sadia Karim', 'email' => 'sadia.karim@example.com', 'team' => 'Platform', 'account' => 2, 'projects' => [6, 0, 7]],
        ['name' => 'Imran Chowdhury', 'email' => 'imran.chowdhury@example.com', 'team' => 'QA', 'account' => 2, 'projects' => [7, 1, 5]],
    ];

    /** @var list<DeviceSpec> */
    private const array DEVICES = [
        ['developer' => 0, 'platform' => 'macos', 'platform_version' => '26.0.1', 'architecture' => 'arm64', 'user' => 'ayesha', 'host' => 'mbp', 'primary' => true, 'last_seen_minutes' => 2],
        ['developer' => 0, 'platform' => 'linux', 'platform_version' => '6.8.0-45-generic', 'architecture' => 'x64', 'user' => 'ayesha', 'host' => 'workstation', 'primary' => false, 'last_seen_minutes' => 4],
        ['developer' => 1, 'platform' => 'windows', 'platform_version' => '10.0.26100', 'architecture' => 'x64', 'user' => 'tanvir', 'host' => 'desktop', 'primary' => true, 'last_seen_minutes' => 1],
        ['developer' => 2, 'platform' => 'macos', 'platform_version' => '15.6.1', 'architecture' => 'arm64', 'user' => 'nusrat', 'host' => 'mba', 'primary' => true, 'last_seen_minutes' => 3],
        ['developer' => 3, 'platform' => 'linux', 'platform_version' => '6.11.0-8-generic', 'architecture' => 'x64', 'user' => 'rafiul', 'host' => 'ubuntu', 'primary' => true, 'last_seen_minutes' => 6],
        ['developer' => 3, 'platform' => 'macos', 'platform_version' => '26.0', 'architecture' => 'arm64', 'user' => 'rafiul', 'host' => 'mbp', 'primary' => false, 'last_seen_minutes' => 180],
        ['developer' => 4, 'platform' => 'linux', 'platform_version' => '6.8.0-45-generic', 'architecture' => 'arm64', 'user' => 'sadia', 'host' => 'fedora', 'primary' => true, 'last_seen_minutes' => 2],
        ['developer' => 5, 'platform' => 'windows', 'platform_version' => '10.0.22631', 'architecture' => 'x64', 'user' => 'imran', 'host' => 'laptop', 'primary' => true, 'last_seen_minutes' => 5],
        ['developer' => 5, 'platform' => 'macos', 'platform_version' => '26.0', 'architecture' => 'x64', 'user' => 'imran', 'host' => 'imac', 'primary' => false, 'last_seen_minutes' => 4320],
    ];

    /** @var list<array{uuid: string, email: string, display_name: string}> */
    private const array ACCOUNTS = [
        ['uuid' => '8b0e4a52-6c1d-4f3e-9a7b-2d5c8e1f0a96', 'email' => 'claude-backend@example.com', 'display_name' => 'Backend Team'],
        ['uuid' => '2f6c9d14-7a3b-4e58-b1c0-9d8e7f6a5b43', 'email' => 'claude-product@example.com', 'display_name' => 'Product Team'],
        ['uuid' => 'c4a1e7b9-0d2f-4c63-8e5a-6b7c8d9e0f12', 'email' => 'claude-platform@example.com', 'display_name' => 'Platform Team'],
    ];

    /** @var list<string> */
    private const array PROJECTS = [
        'acme-api', 'acme-web', 'billing-service', 'design-system',
        'mobile-app', 'android-client', 'infra-terraform', 'qa-automation',
    ];

    /** @var list<array{name: string, weight: int}> */
    private const array SESSION_MODELS = [
        ['name' => 'claude-sonnet-5', 'weight' => 5],
        ['name' => 'claude-opus-5', 'weight' => 3],
        ['name' => 'claude-sonnet-4-5', 'weight' => 2],
    ];

    private const string SIDECHAIN_MODEL = 'claude-haiku-5';

    /** @var list<string> */
    private const array BRANCHES = [
        'main', 'develop', 'feature/login-throttle', 'feature/usage-export', 'fix/chart-resize', 'chore/deps-update',
    ];

    /** @var list<string> */
    private const array PROMPTS = [
        'Add rate limiting to the login endpoint and cover it with a feature test.',
        'Why does the dashboard chart flicker on resize?',
        'Refactor the invoice serializer to use a dedicated resource class.',
        'Write a migration that adds an index on orders.created_at.',
        'Explain what this regular expression matches and simplify it.',
        'Fix the failing snapshot test in the settings page component.',
        'Convert this callback-based helper to async/await.',
        'Add pagination to the projects list endpoint.',
        'Review this function for off-by-one errors.',
        'Generate a Terraform module for the staging S3 bucket.',
    ];

    private TrackingSetting $settings;

    public function __construct(private readonly IngestSyncBatch $ingest) {}

    public function run(): void
    {
        $startedAt = microtime(true);
        $this->settings = TrackingSetting::current();

        $this->seedUsers();
        $developers = $this->seedDevelopers();

        $totals = ['batches' => 0, 'sessions' => 0, 'usage' => 0, 'messages' => 0, 'accepted' => 0, 'rejected' => 0];

        foreach (self::DEVICES as $index => $spec) {
            $developer = $developers[$spec['developer']];
            $device = $this->seedDevice($index, $spec, $developer);
            $cutoff = CarbonImmutable::now('UTC')->subMinutes($spec['last_seen_minutes']);

            if ($device->status === DeviceStatus::Active && $this->enabled(TrackingCategory::Session)) {
                $this->syncDevice($device, $spec, $cutoff, $totals);
            }

            $device->forceFill([
                'last_seen_at' => $cutoff,
                'last_local_activity_at' => $cutoff,
            ])->save();
        }

        $summary = sprintf(
            'MonitorDemoSeeder: %d developers, %d devices, %d batches ingested (%d sessions, %d usage, %d messages; %d accepted, %d rejected) in %.1fs.',
            count($developers),
            count(self::DEVICES),
            $totals['batches'],
            $totals['sessions'],
            $totals['usage'],
            $totals['messages'],
            $totals['accepted'],
            $totals['rejected'],
            microtime(true) - $startedAt,
        );

        $this->command->info($summary);
    }

    private function seedUsers(): void
    {
        $users = [
            ['email' => 'admin@example.com', 'name' => 'Demo Admin', 'role' => UserRole::Admin],
            ['email' => 'viewer@example.com', 'name' => 'Demo Viewer', 'role' => UserRole::Viewer],
        ];

        foreach ($users as $attributes) {
            $user = User::query()->updateOrCreate(
                ['email' => $attributes['email']],
                ['name' => $attributes['name'], 'password' => 'password', 'role' => $attributes['role'], 'is_active' => true],
            );

            if ($user->email_verified_at === null) {
                $user->forceFill(['email_verified_at' => now()])->save();
            }
        }
    }

    /**
     * @return list<Developer>
     */
    private function seedDevelopers(): array
    {
        $developers = [];

        foreach (self::DEVELOPERS as $attributes) {
            $developers[] = Developer::query()->updateOrCreate(
                ['email' => $attributes['email']],
                ['name' => $attributes['name'], 'team' => $attributes['team'], 'status' => DeveloperStatus::Active],
            );
        }

        return $developers;
    }

    /**
     * @param  DeviceSpec  $spec
     */
    private function seedDevice(int $index, array $spec, Developer $developer): Device
    {
        $fingerprint = hash('sha256', self::SEED.'|machine|'.$index);

        return Device::query()->firstOrCreate(
            ['developer_id' => $developer->id, 'machine_fingerprint' => $fingerprint],
            [
                'device_uid' => $this->deviceUid($fingerprint),
                'hostname' => $this->enabled(TrackingCategory::Device) ? $spec['user'].'-'.$spec['host'] : null,
                'platform' => $spec['platform'],
                'platform_version' => $spec['platform_version'],
                'architecture' => $spec['architecture'],
                'agent_version' => self::AGENT_VERSION,
                'status' => DeviceStatus::Active,
                'agent_state' => 'ok',
                'first_seen_at' => OrgClock::now()->subDays(self::HISTORY_DAYS),
            ],
        );
    }

    /**
     * Generate the device's history, split it into contract-sized batches and ingest them.
     *
     * @param  DeviceSpec  $spec
     * @param  array<string, int>  $totals
     */
    private function syncDevice(Device $device, array $spec, CarbonImmutable $cutoff, array &$totals): void
    {
        $sessions = $this->sessionsFor($device, $spec, $cutoff);
        $batches = $this->batchesOf($sessions);
        $cursor = null;
        $sequence = 0;

        foreach ($batches as $position => $batch) {
            $payload = $this->payloadFor($device, $spec, $batch, $cursor, ++$sequence, $position < count($batches) - 1);
            $response = $this->ingest->handle($device, $payload, strlen((string) json_encode($payload)));

            $cursor = is_string($response['cursor'] ?? null) ? $response['cursor'] : $cursor;
            $totals['batches']++;
            $totals['sessions'] += count($payload['sessions']);
            $totals['usage'] += count($payload['usage']);
            $totals['messages'] += count($payload['messages']);
            $totals['accepted'] += (int) ($response['sync']['accepted'] ?? 0);
            $totals['rejected'] += (int) ($response['sync']['rejected'] ?? 0);
        }
    }

    /**
     * Sessions for every org-day of the history window, each day from its own fixed seed so a day's
     * data never depends on when the seeder runs. Records at or after $cutoff are dropped.
     *
     * @param  DeviceSpec  $spec
     * @return list<DemoSession>
     */
    private function sessionsFor(Device $device, array $spec, CarbonImmutable $cutoff): array
    {
        $today = CarbonImmutable::now(OrgClock::timezone())->startOfDay();
        $sessions = [];

        for ($daysAgo = self::HISTORY_DAYS - 1; $daysAgo >= 0; $daysAgo--) {
            $day = $today->subDays($daysAgo);
            $date = $day->format('Y-m-d');
            $rng = new Randomizer(new Mt19937(crc32(self::SEED.'|'.$device->device_uid.'|'.$date)));

            $activeChance = match (true) {
                $day->isWeekend() => $spec['primary'] ? 10 : 5,
                default => $spec['primary'] ? 90 : 35,
            };

            if ($rng->getInt(1, 100) > $activeChance) {
                continue;
            }

            $count = $spec['primary'] ? $rng->getInt(2, 4) : $rng->getInt(1, 2);
            $start = $day->setTime(9, 30)->addMinutes($rng->getInt(0, 75))->addSeconds($rng->getInt(0, 59))->utc();

            for ($number = 0; $number < $count; $number++) {
                $session = $this->makeSession($rng, $device, $spec, $date, $number, $start, $cutoff, $daysAgo);

                if ($session === null) {
                    break;
                }

                $sessions[] = $session;
                $start = $session['last']->addMinutes($rng->getInt(20, 90));
            }
        }

        return $sessions;
    }

    /**
     * @param  DeviceSpec  $spec
     * @return DemoSession|null
     */
    private function makeSession(
        Randomizer $rng,
        Device $device,
        array $spec,
        string $date,
        int $number,
        CarbonImmutable $start,
        CarbonImmutable $cutoff,
        int $daysAgo,
    ): ?array {
        $seed = $device->device_uid.'|'.$date.'|'.$number;
        $sessionId = $this->uuidFrom('session|'.$seed);
        $project = self::DEVELOPERS[$spec['developer']]['projects'][$this->weightedIndex($rng, [6, 3, 1])];
        $model = $this->pickModel($rng);
        $withModel = $this->enabled(TrackingCategory::Model);

        $firstSeen = $start;
        $at = $start->addSeconds($rng->getInt(4, 40));
        $usage = [];
        $latestModel = null;
        $records = $rng->getInt(5, 40);

        for ($index = 0; $index < $records; $index++) {
            if ($at->greaterThanOrEqualTo($cutoff)) {
                break;
            }

            $isSidechain = $index > 0 && $rng->getInt(1, 100) <= 12;
            $recordModel = $isSidechain ? self::SIDECHAIN_MODEL : $model;
            $latestModel = $recordModel;

            $usage[] = [
                'source_message_id' => 'msg_01'.$this->token('msg|'.$seed.'|'.$index, 22),
                'source_session_id' => $sessionId,
                'request_id' => 'req_01'.$this->token('req|'.$seed.'|'.$index, 22),
                'model' => $withModel ? $recordModel : null,
                'is_sidechain' => $isSidechain,
                'recorded_at' => $this->iso($at),
                'input_tokens' => $isSidechain ? $rng->getInt(200, 3000) : $rng->getInt(1, 12),
                'output_tokens' => $rng->getInt(100, 4000),
                'cache_creation_tokens' => match (true) {
                    $index === 0 => $rng->getInt(20000, 60000),
                    $rng->getInt(1, 100) <= 35 => 0,
                    default => $rng->getInt(500, 30000),
                },
                'cache_read_tokens' => min(400000, 5000 + $index * $rng->getInt(3000, 12000) + $rng->getInt(0, 20000)),
            ];

            $at = $at->addSeconds($rng->getInt(15, 240))->addMilliseconds($rng->getInt(0, 999));
        }

        if ($usage === []) {
            return null;
        }

        $lastSeen = CarbonImmutable::parse((string) $usage[array_key_last($usage)]['recorded_at']);
        $ended = $lastSeen->lessThan($cutoff->subHours(2)) && $rng->getInt(1, 100) <= 60;

        $messages = [];

        if ($this->enabled(TrackingCategory::Prompt)) {
            $messages[] = [
                'source_message_id' => $this->uuidFrom('prompt|'.$seed.'|0'),
                'source_session_id' => $sessionId,
                'role' => 'user',
                'content' => self::PROMPTS[$rng->getInt(0, count(self::PROMPTS) - 1)],
                'recorded_at' => $this->iso($firstSeen),
            ];
        }

        return [
            'project' => $project,
            'first' => $firstSeen,
            'last' => $lastSeen,
            'record' => [
                'source_session_id' => $sessionId,
                'project_key' => $this->enabled(TrackingCategory::Project) ? $this->projectKey($device, $spec, $project) : null,
                'account_key' => null,
                'first_seen_at' => $this->iso($firstSeen),
                'last_seen_at' => $this->iso($lastSeen),
                'ended_at' => $ended ? $this->iso($lastSeen) : null,
                'claude_code_version' => $this->claudeCodeVersion($daysAgo),
                'entrypoint' => $rng->getInt(1, 100) <= 90 ? 'cli' : 'sdk-cli',
                'git_branch' => $this->enabled(TrackingCategory::Git) ? self::BRANCHES[$rng->getInt(0, count(self::BRANCHES) - 1)] : null,
                'model' => $withModel ? $latestModel : null,
            ],
            'usage' => $this->enabled(TrackingCategory::Usage) ? $usage : [],
            'messages' => $messages,
        ];
    }

    /**
     * Greedily pack sessions (with their usage and messages) into batches within the contract limits.
     *
     * @param  list<DemoSession>  $sessions
     * @return list<list<DemoSession>>
     */
    private function batchesOf(array $sessions): array
    {
        $batches = [];
        $current = [];
        $usage = 0;
        $messages = 0;

        foreach ($sessions as $session) {
            $fits = count($current) < self::LIMITS['sessions']
                && $usage + count($session['usage']) <= self::LIMITS['usage']
                && $messages + count($session['messages']) <= self::LIMITS['messages'];

            if (! $fits && $current !== []) {
                $batches[] = $current;
                $current = [];
                $usage = 0;
                $messages = 0;
            }

            $current[] = $session;
            $usage += count($session['usage']);
            $messages += count($session['messages']);
        }

        if ($current !== []) {
            $batches[] = $current;
        }

        return $batches;
    }

    /**
     * A full contract-shaped sync request (every field present, explicit nulls).
     *
     * @param  DeviceSpec  $spec
     * @param  list<DemoSession>  $batch
     * @return array{agent: Record, sync: Record, accounts: list<Record>, projects: list<Record>, sessions: list<Record>, usage: list<Record>, messages: list<Record>}
     */
    private function payloadFor(Device $device, array $spec, array $batch, ?string $cursor, int $sequence, bool $isInitial): array
    {
        $developer = self::DEVELOPERS[$spec['developer']];
        $account = self::ACCOUNTS[$developer['account']];
        $accountKey = hash('sha256', $account['uuid']);
        $withAccount = $this->enabled(TrackingCategory::Account);
        $withProject = $this->enabled(TrackingCategory::Project);
        $withGit = $this->enabled(TrackingCategory::Git);

        /** @var array<int, array{first: CarbonImmutable, last: CarbonImmutable}> $projectSpans */
        $projectSpans = [];
        $sessions = [];
        $usage = [];
        $messages = [];
        $latest = $batch[0]['last'];

        foreach ($batch as $session) {
            $span = $projectSpans[$session['project']] ?? ['first' => $session['first'], 'last' => $session['last']];
            $projectSpans[$session['project']] = [
                'first' => $span['first']->min($session['first']),
                'last' => $span['last']->max($session['last']),
            ];
            $latest = $latest->max($session['last']);

            $sessions[] = [...$session['record'], 'account_key' => $withAccount ? $accountKey : null];
            array_push($usage, ...$session['usage']);
            array_push($messages, ...$session['messages']);
        }

        $projects = [];

        if ($withProject) {
            foreach ($projectSpans as $project => $span) {
                $name = self::PROJECTS[$project];
                $projects[] = [
                    'project_key' => $this->projectKey($device, $spec, $project),
                    'name' => $name,
                    'path' => $this->projectPath($spec, $name),
                    'git_remote' => $withGit ? $this->gitRemote($name) : null,
                    'first_seen_at' => $this->iso($span['first']),
                    'last_seen_at' => $this->iso($span['last']),
                ];
            }
        }

        $accounts = $withAccount ? [[
            'account_key' => $accountKey,
            'account_uuid' => $account['uuid'],
            'email' => $account['email'],
            'display_name' => $account['display_name'],
            'organization_uuid' => self::ORGANIZATION_UUID,
            'organization_name' => self::ORGANIZATION_NAME,
            'observed_at' => $this->iso($latest),
        ]] : [];

        $records = compact('accounts', 'projects', 'sessions', 'usage', 'messages');

        return [
            'agent' => [
                'device_id' => $device->device_uid,
                'platform' => $spec['platform'],
                'platform_version' => $spec['platform_version'],
                'architecture' => $spec['architecture'],
                'agent_version' => self::AGENT_VERSION,
                'claude_code_version' => $sessions[array_key_last($sessions)]['claude_code_version'],
            ],
            'sync' => [
                // Content-addressed: identical records replay the stored response, changed records form a new batch.
                'batch_id' => $this->uuidFrom('batch|'.$device->device_uid.'|'.json_encode($records)),
                'cursor' => $cursor,
                'is_initial' => $isInitial,
                'settings_version' => (int) $this->settings->version,
                'sequence' => $sequence,
            ],
            ...$records,
        ];
    }

    private function enabled(TrackingCategory $category): bool
    {
        return $this->settings->enabled($category);
    }

    /**
     * D13: remote-derived key only when Git is ON (the demo repos all have a remote), else device + cwd.
     *
     * @param  DeviceSpec  $spec
     */
    private function projectKey(Device $device, array $spec, int $project): string
    {
        $name = self::PROJECTS[$project];

        if ($this->enabled(TrackingCategory::Git)) {
            return hash('sha256', $this->gitRemote($name));
        }

        return hash('sha256', $device->device_uid."\n".$this->projectPath($spec, $name));
    }

    /**
     * @param  DeviceSpec  $spec
     */
    private function projectPath(array $spec, string $name): string
    {
        return match ($spec['platform']) {
            'macos' => "/Users/{$spec['user']}/work/{$name}",
            'windows' => "C:\\Users\\{$spec['user']}\\work\\{$name}",
            default => "/home/{$spec['user']}/work/{$name}",
        };
    }

    private function gitRemote(string $name): string
    {
        return "github.com/example-org/{$name}";
    }

    private function claudeCodeVersion(int $daysAgo): string
    {
        return match (true) {
            $daysAgo > 40 => '2.1.240',
            $daysAgo > 15 => '2.1.260',
            default => '2.1.274',
        };
    }

    private function pickModel(Randomizer $rng): string
    {
        $weights = array_map(fn (array $model): int => $model['weight'], self::SESSION_MODELS);

        return self::SESSION_MODELS[$this->weightedIndex($rng, $weights)]['name'];
    }

    /**
     * @param  list<int>  $weights
     */
    private function weightedIndex(Randomizer $rng, array $weights): int
    {
        $roll = $rng->getInt(1, array_sum($weights));

        foreach ($weights as $index => $weight) {
            $roll -= $weight;

            if ($roll <= 0) {
                return $index;
            }
        }

        return 0;
    }

    private function iso(CarbonImmutable $moment): string
    {
        return $moment->utc()->format('Y-m-d\TH:i:s.v\Z');
    }

    /**
     * A deterministic RFC 4122 version-4-formatted UUID derived from $seed.
     */
    private function uuidFrom(string $seed): string
    {
        $hex = md5(self::SEED.'|'.$seed);
        $hex[12] = '4';
        $hex[16] = '89ab'[hexdec($hex[16]) & 3];

        return sprintf('%s-%s-%s-%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20, 12));
    }

    /**
     * A deterministic Crockford base32 token of $length characters.
     */
    private function token(string $seed, int $length): string
    {
        $bytes = hash('sha256', self::SEED.'|'.$seed, true);
        $token = '';

        for ($index = 0; $index < $length; $index++) {
            $token .= self::CROCKFORD[ord($bytes[$index]) % 32];
        }

        return $token;
    }

    private function deviceUid(string $fingerprint): string
    {
        return 'dev_01K'.$this->token('device|'.$fingerprint, 23);
    }
}
