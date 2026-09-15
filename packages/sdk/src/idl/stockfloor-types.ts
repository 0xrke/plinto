/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/stockfloor.json`.
 */
export type Stockfloor = {
  "address": "98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA",
  "metadata": {
    "name": "stockfloor",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "StockFloor: DBC launches with a redeemable stock-backed floor vault"
  },
  "instructions": [
    {
      "name": "burnClaimerBase",
      "docs": [
        "Permissionless: burn base tokens held by the claimer PDA (donations)."
      ],
      "discriminator": [
        253,
        85,
        51,
        98,
        140,
        230,
        148,
        102
      ],
      "accounts": [
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "claimer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "claimerBaseAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "claimer"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "baseMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "baseMint",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createLaunch",
      "docs": [
        "Validate a DBC config and create the launch registry and floor vault."
      ],
      "discriminator": [
        239,
        223,
        255,
        134,
        39,
        121,
        127,
        62
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "creator",
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "DBC PoolConfig; owner, discriminator, size and fields are validated in the handler.",
            "The config keypair must sign so that nobody can front-run `create_launch` for a",
            "config they did not create."
          ],
          "signer": true
        },
        {
          "name": "claimer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "baseMint"
        },
        {
          "name": "vault",
          "docs": [
            "`init_if_needed` so that a third party pre-creating the ATA cannot block the launch."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultAuthority"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "exitFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "floor",
      "docs": [
        "View: vault balance, supply, exit fee and floor per token (return data + event)."
      ],
      "discriminator": [
        18,
        151,
        114,
        3,
        139,
        54,
        134,
        97
      ],
      "accounts": [
        {
          "name": "launch",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "vault"
        },
        {
          "name": "baseMint"
        }
      ],
      "args": [],
      "returns": {
        "defined": {
          "name": "floorInfo"
        }
      }
    },
    {
      "name": "harvestCurveFees",
      "docs": [
        "Permissionless: partner trading fees from the DBC curve into the vault."
      ],
      "discriminator": [
        118,
        229,
        208,
        190,
        86,
        99,
        210,
        89
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "claimer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "config"
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "claimerBaseAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "claimer"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "baseMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "dbcBaseVault",
          "writable": true
        },
        {
          "name": "dbcQuoteVault",
          "writable": true
        },
        {
          "name": "baseMint",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "dbcPoolAuthority",
          "address": "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM"
        },
        {
          "name": "dbcEventAuthority",
          "address": "8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF"
        },
        {
          "name": "dbcProgram",
          "address": "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
        }
      ],
      "args": []
    },
    {
      "name": "harvestLpFees",
      "docs": [
        "Permissionless: DAMM v2 LP fees; quote into the vault, base burned."
      ],
      "discriminator": [
        153,
        236,
        19,
        193,
        135,
        211,
        138,
        173
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "claimer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "dammPool"
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "positionNftAccount"
        },
        {
          "name": "claimerBaseAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "claimer"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "baseMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "dammTokenAVault",
          "writable": true
        },
        {
          "name": "dammTokenBVault",
          "writable": true
        },
        {
          "name": "baseMint",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "dammPoolAuthority",
          "address": "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC"
        },
        {
          "name": "dammEventAuthority",
          "address": "3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet"
        },
        {
          "name": "dammProgram",
          "address": "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"
        }
      ],
      "args": []
    },
    {
      "name": "harvestMigrationFee",
      "docs": [
        "Permissionless: partner migration fee into the vault (once)."
      ],
      "discriminator": [
        165,
        11,
        14,
        56,
        82,
        214,
        7,
        37
      ],
      "accounts": [
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "claimer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "config"
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "dbcQuoteVault",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "dbcPoolAuthority",
          "address": "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM"
        },
        {
          "name": "dbcEventAuthority",
          "address": "8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF"
        },
        {
          "name": "dbcProgram",
          "address": "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
        }
      ],
      "args": []
    },
    {
      "name": "harvestSurplus",
      "docs": [
        "Permissionless: partner curve surplus into the vault (once)."
      ],
      "discriminator": [
        236,
        96,
        88,
        108,
        204,
        8,
        146,
        7
      ],
      "accounts": [
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "claimer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "config"
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "dbcQuoteVault",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "dbcPoolAuthority",
          "address": "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM"
        },
        {
          "name": "dbcEventAuthority",
          "address": "8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF"
        },
        {
          "name": "dbcProgram",
          "address": "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
        }
      ],
      "args": []
    },
    {
      "name": "redeem",
      "docs": [
        "Burn base tokens for a pro-rata share of the vault minus the exit fee."
      ],
      "discriminator": [
        184,
        12,
        86,
        149,
        70,
        196,
        97,
        225
      ],
      "accounts": [
        {
          "name": "holder",
          "signer": true
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "pool"
        },
        {
          "name": "baseMint",
          "writable": true
        },
        {
          "name": "holderBaseAccount",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "holderQuoteAccount",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "quoteTokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "registerPool",
      "docs": [
        "Permissionless: register the DBC pool of the committed base mint (once)."
      ],
      "discriminator": [
        85,
        229,
        114,
        47,
        75,
        145,
        166,
        100
      ],
      "accounts": [
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "config"
        },
        {
          "name": "pool"
        },
        {
          "name": "baseMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "syncMigration",
      "docs": [
        "Permissionless: latch `Launch.migrated` once the DBC pool migrated (idempotent)."
      ],
      "discriminator": [
        225,
        231,
        95,
        199,
        32,
        239,
        236,
        87
      ],
      "accounts": [
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "launch.config",
                "account": "launch"
              }
            ]
          }
        },
        {
          "name": "pool"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "launch",
      "discriminator": [
        144,
        51,
        51,
        163,
        206,
        85,
        213,
        38
      ]
    }
  ],
  "events": [
    {
      "name": "claimerBaseBurned",
      "discriminator": [
        226,
        23,
        1,
        39,
        166,
        204,
        14,
        19
      ]
    },
    {
      "name": "curveFeesHarvested",
      "discriminator": [
        119,
        172,
        204,
        5,
        251,
        116,
        183,
        167
      ]
    },
    {
      "name": "floorSnapshot",
      "discriminator": [
        157,
        248,
        66,
        152,
        84,
        129,
        151,
        71
      ]
    },
    {
      "name": "launchCreated",
      "discriminator": [
        59,
        38,
        190,
        230,
        33,
        34,
        89,
        20
      ]
    },
    {
      "name": "lpFeesHarvested",
      "discriminator": [
        230,
        156,
        123,
        178,
        68,
        124,
        167,
        67
      ]
    },
    {
      "name": "migrationFeeHarvested",
      "discriminator": [
        26,
        179,
        172,
        116,
        15,
        107,
        89,
        212
      ]
    },
    {
      "name": "migrationLatched",
      "discriminator": [
        232,
        38,
        47,
        224,
        253,
        56,
        5,
        20
      ]
    },
    {
      "name": "poolRegistered",
      "discriminator": [
        77,
        114,
        165,
        230,
        33,
        230,
        135,
        215
      ]
    },
    {
      "name": "redeemed",
      "discriminator": [
        14,
        29,
        183,
        71,
        31,
        165,
        107,
        38
      ]
    },
    {
      "name": "surplusHarvested",
      "discriminator": [
        204,
        225,
        39,
        46,
        225,
        216,
        78,
        91
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidDbcConfig",
      "msg": "Config account is not a DBC PoolConfig (wrong owner, discriminator or size)"
    },
    {
      "code": 6001,
      "name": "feeClaimerMismatch",
      "msg": "DBC config fee_claimer must be the launch claimer PDA (seeds: authority, config)"
    },
    {
      "code": 6002,
      "name": "leftoverReceiverMismatch",
      "msg": "DBC config leftover_receiver must be the launch claimer PDA (seeds: authority, config)"
    },
    {
      "code": 6003,
      "name": "creatorMigrationFeeNotZero",
      "msg": "DBC config creator_migration_fee_percentage must be 0"
    },
    {
      "code": 6004,
      "name": "migrationFeePercentageOutOfRange",
      "msg": "DBC config migration_fee_percentage must be within [30, 99]"
    },
    {
      "code": 6005,
      "name": "liquidityNotFullyPartnerLocked",
      "msg": "DBC config must lock 100% of migrated liquidity permanently for the partner"
    },
    {
      "code": 6006,
      "name": "liquidityVestingNotAllowed",
      "msg": "DBC config must not use liquidity vesting"
    },
    {
      "code": 6007,
      "name": "lockedVestingNotAllowed",
      "msg": "DBC config must not have a locked vesting token allocation"
    },
    {
      "code": 6008,
      "name": "collectFeeModeNotQuote",
      "msg": "DBC config collect_fee_mode must be QuoteToken"
    },
    {
      "code": 6009,
      "name": "migrationOptionNotDammV2",
      "msg": "DBC config migration_option must be DAMM v2"
    },
    {
      "code": 6010,
      "name": "baseTokenTypeNotSplToken",
      "msg": "DBC config base token type must be SPL Token"
    },
    {
      "code": 6011,
      "name": "exitFeeTooHigh",
      "msg": "Exit fee exceeds the 500 bps cap"
    },
    {
      "code": 6012,
      "name": "quoteMintMismatch",
      "msg": "Quote mint does not match the DBC config quote mint"
    },
    {
      "code": 6013,
      "name": "fixedTokenSupplyNotAllowed",
      "msg": "DBC config must use dynamic token supply (fixed supply is not supported)"
    },
    {
      "code": 6014,
      "name": "creatorTradingFeeTooHigh",
      "msg": "DBC config creator_trading_fee_percentage exceeds 30"
    },
    {
      "code": 6015,
      "name": "curveFeeTooHigh",
      "msg": "DBC config base fee must be a fee scheduler with a cliff fee of at most 20%"
    },
    {
      "code": 6016,
      "name": "dynamicFeeNotAllowed",
      "msg": "DBC config must not enable the dynamic (volatility) fee"
    },
    {
      "code": 6017,
      "name": "migratedCollectFeeModeNotQuote",
      "msg": "DBC config migrated_collect_fee_mode must be QuoteToken"
    },
    {
      "code": 6018,
      "name": "tokenUpdateAuthorityNotImmutable",
      "msg": "DBC config token_update_authority must be Immutable"
    },
    {
      "code": 6019,
      "name": "poolCreationFeeNotZero",
      "msg": "DBC config pool_creation_fee must be 0"
    },
    {
      "code": 6020,
      "name": "invalidBaseMint",
      "msg": "Base mint must not be the default pubkey or the quote mint"
    },
    {
      "code": 6021,
      "name": "invalidDbcPool",
      "msg": "Pool account is not a DBC VirtualPool (wrong owner, discriminator or size)"
    },
    {
      "code": 6022,
      "name": "poolAlreadyRegistered",
      "msg": "A pool is already registered for this launch"
    },
    {
      "code": 6023,
      "name": "poolNotRegistered",
      "msg": "No pool is registered for this launch yet"
    },
    {
      "code": 6024,
      "name": "poolConfigMismatch",
      "msg": "DBC pool belongs to a different config"
    },
    {
      "code": 6025,
      "name": "baseMintMismatch",
      "msg": "Base mint does not match the DBC pool base mint"
    },
    {
      "code": 6026,
      "name": "poolTypeNotSplToken",
      "msg": "DBC pool base token must be SPL Token"
    },
    {
      "code": 6027,
      "name": "baseMintDecimalsMismatch",
      "msg": "Base mint decimals do not match the DBC config"
    },
    {
      "code": 6028,
      "name": "baseMintAuthorityNotRevoked",
      "msg": "Base mint still has a mint authority"
    },
    {
      "code": 6029,
      "name": "baseMintHasFreezeAuthority",
      "msg": "Base mint has a freeze authority"
    },
    {
      "code": 6030,
      "name": "curveNotComplete",
      "msg": "DBC curve is not complete yet"
    },
    {
      "code": 6031,
      "name": "migrationFeeAlreadyHarvested",
      "msg": "Migration fee was already harvested"
    },
    {
      "code": 6032,
      "name": "surplusAlreadyHarvested",
      "msg": "Surplus was already harvested"
    },
    {
      "code": 6033,
      "name": "invalidDammPool",
      "msg": "Account is not a DAMM v2 Pool"
    },
    {
      "code": 6034,
      "name": "invalidDammPosition",
      "msg": "Account is not a DAMM v2 Position"
    },
    {
      "code": 6035,
      "name": "positionPoolMismatch",
      "msg": "Position belongs to a different DAMM v2 pool"
    },
    {
      "code": 6036,
      "name": "dammPoolMintMismatch",
      "msg": "DAMM v2 pool mints must be (launch base mint, launch quote mint)"
    },
    {
      "code": 6037,
      "name": "positionNftNotOwnedByClaimer",
      "msg": "Position NFT account is not owned by the launch claimer PDA or does not hold the position NFT"
    },
    {
      "code": 6038,
      "name": "vaultDecreased",
      "msg": "Vault balance decreased during a harvest"
    },
    {
      "code": 6039,
      "name": "vaultEncumbered",
      "msg": "Vault token account has a delegate, close authority, an owner other than the vault authority, CPI guard or required memo"
    },
    {
      "code": 6040,
      "name": "migrationNotComplete",
      "msg": "DBC pool migration to DAMM v2 is not complete"
    },
    {
      "code": 6041,
      "name": "migrationFeeNotHarvested",
      "msg": "Migration fee must be harvested before redemptions open"
    },
    {
      "code": 6042,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6043,
      "name": "insufficientBaseBalance",
      "msg": "Insufficient base token balance"
    },
    {
      "code": 6044,
      "name": "zeroSupply",
      "msg": "Base mint supply is zero"
    },
    {
      "code": 6045,
      "name": "nothingToRedeem",
      "msg": "Redemption would pay nothing (net amount is zero)"
    },
    {
      "code": 6046,
      "name": "invalidFeeBps",
      "msg": "Invalid exit fee basis points"
    },
    {
      "code": 6047,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6048,
      "name": "vaultBalanceMismatch",
      "msg": "Vault balance after redemption does not match the expected amount"
    },
    {
      "code": 6049,
      "name": "supplyMismatch",
      "msg": "Base mint supply after burn does not match the expected amount"
    },
    {
      "code": 6050,
      "name": "floorDecreased",
      "msg": "Floor per token would decrease"
    },
    {
      "code": 6051,
      "name": "destinationIsVault",
      "msg": "The payout destination cannot be the vault"
    },
    {
      "code": 6052,
      "name": "quoteMintPaused",
      "msg": "Quote mint is paused by its issuer"
    },
    {
      "code": 6053,
      "name": "quoteMintTransferHookUnsupported",
      "msg": "Quote mint has an active transfer hook, which is not supported"
    },
    {
      "code": 6054,
      "name": "vaultFrozen",
      "msg": "Vault token account is frozen"
    },
    {
      "code": 6055,
      "name": "invalidQuoteMintData",
      "msg": "Invalid Token-2022 mint data"
    },
    {
      "code": 6056,
      "name": "invalidTokenAccountData",
      "msg": "Invalid token account data"
    },
    {
      "code": 6057,
      "name": "floorAccountMismatch",
      "msg": "Base mint account does not match the launch"
    }
  ],
  "types": [
    {
      "name": "claimerBaseBurned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "baseBurned",
            "docs": [
              "Base tokens burned from the claimer's base ATA (0 when it was empty)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "curveFeesHarvested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "quoteAmount",
            "type": "u64"
          },
          {
            "name": "baseBurned",
            "type": "u64"
          },
          {
            "name": "vaultBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "floorInfo",
      "docs": [
        "Return value of the `floor` view."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultRaw",
            "docs": [
              "Raw quote units in the vault."
            ],
            "type": "u64"
          },
          {
            "name": "supply",
            "docs": [
              "Raw base mint supply (0 before `register_pool`)."
            ],
            "type": "u64"
          },
          {
            "name": "exitFeeBps",
            "docs": [
              "Exit fee in basis points."
            ],
            "type": "u16"
          },
          {
            "name": "floorQ64",
            "docs": [
              "Floor per token as Q64.64 raw quote units per raw base unit:",
              "`(vault_raw << 64) / supply`, 0 when the supply is 0."
            ],
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "floorSnapshot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "vaultRaw",
            "type": "u64"
          },
          {
            "name": "supply",
            "type": "u64"
          },
          {
            "name": "exitFeeBps",
            "type": "u16"
          },
          {
            "name": "floorQ64",
            "docs": [
              "`(vault_raw << 64) / supply`, 0 when the supply is 0."
            ],
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "launch",
      "docs": [
        "Per-launch registry. PDA `[\"launch\", config]`.",
        "",
        "There is no admin field: nothing in this account can be changed by anyone",
        "except through the permissionless instructions of this program.",
        "",
        "Layout version 2 (`8 + 343` bytes, unchanged in size from version 1: the vault authority bump",
        "took one reserved byte)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "docs": [
              "Account layout version."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump of this account."
            ],
            "type": "u8"
          },
          {
            "name": "claimerBump",
            "docs": [
              "PDA bump of the claimer `[\"authority\", config]` (DBC fee_claimer, LP NFT owner, CPI signer)."
            ],
            "type": "u8"
          },
          {
            "name": "vaultAuthorityBump",
            "docs": [
              "PDA bump of the vault authority `[\"vault_authority\", config]` (vault owner, signs only the",
              "`redeem` payout)."
            ],
            "type": "u8"
          },
          {
            "name": "exitFeeBps",
            "docs": [
              "Exit fee in basis points, immutable, <= 500."
            ],
            "type": "u16"
          },
          {
            "name": "migrationFeeHarvested",
            "docs": [
              "`true` once the partner migration fee has been moved into the vault. Redemptions",
              "require it."
            ],
            "type": "bool"
          },
          {
            "name": "surplusHarvested",
            "docs": [
              "`true` once the partner surplus has been moved into the vault."
            ],
            "type": "bool"
          },
          {
            "name": "migrated",
            "docs": [
              "Latched to `true` the first time this program sees the registered DBC pool fully",
              "migrated to DAMM v2 (`sync_migration`, `harvest_migration_fee`, `harvest_surplus` or the",
              "first `redeem`). Once set, `redeem` never decodes DBC state again, so a later DBC upgrade",
              "that changes the VirtualPool layout cannot lock redemptions."
            ],
            "type": "bool"
          },
          {
            "name": "config",
            "docs": [
              "DBC config (one config per launch)."
            ],
            "type": "pubkey"
          },
          {
            "name": "creator",
            "docs": [
              "Launch creator (signed `create_launch`). Informational: registration is permissionless."
            ],
            "type": "pubkey"
          },
          {
            "name": "pool",
            "docs": [
              "Canonical DBC virtual pool. `Pubkey::default()` until `register_pool`."
            ],
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "docs": [
              "Base token mint (SPL Token), committed by `create_launch`. The DBC pool of",
              "`(config, base_mint)` is unique, so `register_pool` is permissionless."
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "docs": [
              "Quote mint (from the DBC config)."
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteTokenProgram",
            "docs": [
              "Token program owning the quote mint (Token-2022 for xStocks)."
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "Floor vault: ATA(vault authority, quote_mint, quote_token_program)."
            ],
            "type": "pubkey"
          },
          {
            "name": "createdAt",
            "docs": [
              "Unix timestamp of `create_launch`."
            ],
            "type": "i64"
          },
          {
            "name": "totalHarvestedQuote",
            "docs": [
              "Informational counters (saturating; never used for access control or math)."
            ],
            "type": "u64"
          },
          {
            "name": "totalBurnedBase",
            "type": "u64"
          },
          {
            "name": "totalRedeemedBase",
            "type": "u64"
          },
          {
            "name": "totalRedeemedQuote",
            "type": "u64"
          },
          {
            "name": "totalExitFees",
            "type": "u64"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for future fields."
            ],
            "type": {
              "array": [
                "u8",
                62
              ]
            }
          }
        ]
      }
    },
    {
      "name": "launchCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "claimer",
            "docs": [
              "Claimer PDA `[\"authority\", config]`: DBC fee_claimer / leftover_receiver, LP NFT owner."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultAuthority",
            "docs": [
              "Vault authority PDA `[\"vault_authority\", config]`: owner of the vault."
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "docs": [
              "Base mint committed for the launch's DBC pool."
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteTokenProgram",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "exitFeeBps",
            "type": "u16"
          },
          {
            "name": "migrationFeePercentage",
            "type": "u8"
          },
          {
            "name": "migrationQuoteThreshold",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "lpFeesHarvested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "dammPool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "quoteAmount",
            "type": "u64"
          },
          {
            "name": "baseBurned",
            "type": "u64"
          },
          {
            "name": "vaultBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "migrationFeeHarvested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "quoteAmount",
            "type": "u64"
          },
          {
            "name": "vaultBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "migrationLatched",
      "docs": [
        "`Launch.migrated` latched by `sync_migration` (the harvests and `redeem` latch without an event)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "poolRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "redeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "baseAmount",
            "type": "u64"
          },
          {
            "name": "gross",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "net",
            "type": "u64"
          },
          {
            "name": "vaultBefore",
            "type": "u64"
          },
          {
            "name": "supplyBefore",
            "type": "u64"
          },
          {
            "name": "vaultAfter",
            "type": "u64"
          },
          {
            "name": "supplyAfter",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "surplusHarvested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "quoteAmount",
            "type": "u64"
          },
          {
            "name": "vaultBalance",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
