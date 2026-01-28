import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, Transaction, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import idl from "@/app/idl/emperor_program.json";

// Headers required for Solana Actions
const ACTIONS_CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Content-Encoding, Accept-Encoding",
  "x-blockchain-ids": 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  "x-action-version": "2.4",             // 当前最新规范版本（写死 2.4 基本没问题）
};

const PROGRAM_ID = new PublicKey(idl.address);

// Mock Wallet for read-only provider
const createReadOnlyWallet = (pubkey?: PublicKey) => {
  return {
    publicKey: pubkey || new PublicKey("11111111111111111111111111111111"),
    signTransaction: async (tx: Transaction) => tx,
    signAllTransactions: async (txs: Transaction[]) => txs,
  };
};

// Helper to get program instance
const getProgram = (connection: Connection) => {
  const provider = new AnchorProvider(
    connection,
    createReadOnlyWallet() as any,
    { commitment: "confirmed" }
  );
  return new Program(idl as any, provider) as any;
};

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: ACTIONS_CORS_HEADERS,
  });
}

export async function GET(request: NextRequest) {
  try {
    const connection = new Connection(process.env.RPC_URL || "http://127.0.0.1:8899", "confirmed");
    const program = getProgram(connection);

    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game")],
      PROGRAM_ID
    );

    let title = "Become the On-Chain Emperor";
    let description = "Bid 10% more to capture the throne! Earn 5% profit when outbid.";
    let label = "Defeat Emperor";

    try {
      const gameState = await program.account.game.fetch(gamePda);
      const currentBidSol = gameState.currentBid.toNumber() / LAMPORTS_PER_SOL;
      const nextBidSol = currentBidSol * 1.1; // approximate

      description = `Current Emperor: ${gameState.currentEmperor.toBase58().substring(0, 6)}... \n` +
        `Current Bid: ${currentBidSol.toFixed(2)} SOL \n` +
        `Price to pay: ~${nextBidSol.toFixed(3)} SOL (Returns 5% profit when you are outbid!)`;
      label = `Claim Throne (${nextBidSol.toFixed(3)} SOL)`;
    } catch (e) {
      console.log("Game not initialized or fetch failed", e);
      description += " (Game not currently active on this network)";
    }

    const payload = {
      icon: "/icon.png", // Keep placeholder or change
      label: label,
      title: title,
      description: description,
      links: {
        actions: [
          {
            label: label,
            href: "/api/actions/click", // Points to POST
          },
        ],
      },
    };

    return NextResponse.json(payload, {
      headers: ACTIONS_CORS_HEADERS,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal Error" }, { status: 500, headers: ACTIONS_CORS_HEADERS });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { account } = body;

    if (!account) {
      return NextResponse.json({ error: "Missing account" }, { status: 400, headers: ACTIONS_CORS_HEADERS });
    }

    const userPubkey = new PublicKey(account);
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const program = getProgram(connection);

    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game")],
      PROGRAM_ID
    );

    // Fetch Game State
    let gameState;
    try {
      gameState = await program.account.game.fetch(gamePda);
    } catch (e) {
      return NextResponse.json({ error: "Game not initialized" }, { status: 400, headers: ACTIONS_CORS_HEADERS });
    }

    // Build Instruction
    const ix = await program.methods
      .claimThrone()
      .accounts({
        game: gamePda,
        user: userPubkey,
        currentEmperorAccount: gameState.currentEmperor,
        feeRecipientAccount: gameState.feeRecipient,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const transaction = new Transaction().add(ix);
    transaction.feePayer = userPubkey;

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    const serializedTransaction = transaction.serialize({ requireAllSignatures: false }).toString("base64");

    const payload = {
      transaction: serializedTransaction,
      message: "Proclaiming new Emperor!",
    };

    return NextResponse.json(payload, {
      headers: ACTIONS_CORS_HEADERS,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: ACTIONS_CORS_HEADERS });
  }
}
