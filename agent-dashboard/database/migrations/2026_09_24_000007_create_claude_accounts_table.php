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
        Schema::create('claude_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('developer_id')->constrained('developers')->restrictOnDelete();
            $table->char('account_key', 64);
            $table->string('account_uuid', 64)->nullable();
            $table->string('email', 191)->nullable();
            $table->string('display_name', 191)->nullable();
            $table->string('organization_uuid', 64)->nullable();
            $table->string('organization_name', 191)->nullable();
            $table->string('status', 16)->default('active');
            $table->timestamp('first_seen_at')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamps();

            $table->unique(['developer_id', 'account_key']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('claude_accounts');
    }
};
