<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('devices', function (Blueprint $table) {
            $table->id();
            $table->char('device_uid', 30)->unique();
            $table->foreignId('developer_id')->constrained('developers')->restrictOnDelete();
            $table->char('machine_fingerprint', 64);
            $table->string('hostname', 191)->nullable();
            $table->string('platform', 16);
            $table->string('platform_version', 64)->nullable();
            $table->string('architecture', 64)->nullable();
            $table->string('agent_version', 64)->nullable();
            $table->string('claude_code_version', 64)->nullable();
            $table->string('status', 16)->default('active');
            $table->string('agent_state', 32)->nullable();
            $table->timestamp('first_seen_at')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('last_sync_at')->nullable();
            $table->timestamp('last_local_activity_at')->nullable();
            $table->timestamp('sync_requested_at')->nullable();
            $table->string('last_public_ip', 45)->nullable();
            $table->timestamp('disabled_at')->nullable();
            $table->timestamp('uninstalled_at')->nullable();
            $table->timestamps();

            $table->unique(['developer_id', 'machine_fingerprint']);
            $table->index(['status', 'last_seen_at']);
            $table->index('developer_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('devices');
    }
};
