// Firebase Cloud Function: finc/index.js
// This code runs on Google's servers, not in the browser.

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const Stripe = require("stripe"); // Changed to uppercase as per 'new-cap' rule

// Initialize our Firebase app
admin.initializeApp();

// Create an 'express' app to handle web requests
const app = express();

// --- Configuration ---
// Get our Stripe secret keys from the Firebase environment
// We will set these in the instructions (Part 3)
const stripeSecret = functions.config().stripe.secret;
const stripeWebhookSecret = functions.config().stripe.webhook_secret;

// Initialize the Stripe library
const stripeClient = new Stripe(stripeSecret, {apiVersion: "2024-04-10"});

// --- The Webhook Endpoint ---
// This is the URL that Stripe will send messages to.
// We use express.raw to get the "raw" body from Stripe to verify its signature
app.post(
    "/stripe-webhook",
    express.raw({type: "application/json"}),
    async (req, res) => {
      // 1. Get the Stripe Signature from the request header
      const sig = req.headers["stripe-signature"];

      let event;

      // 2. Verify the signature (SECURITY STEP)
      // This proves the message actually came from Stripe
      try {
        event = stripeClient.webhooks.constructEvent(
            req.body,
            sig,
            stripeWebhookSecret,
        );
      } catch (err) {
        console.warn("⚠️ Webhook signature verification failed.", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      // 3. Handle the event
      try {
        if (event.type === "checkout.session.completed") {
          const session = event.data.object;

          // Get the userId we passed in the payment link
          // This is why ?client_reference_id=... was so important!
          const userId = session.client_reference_id;

          if (userId) {
            console.log(`✅ Payment successful for user: ${userId}`);

            // --- THIS IS THE KEY ---
            // Get a reference to our Firestore database
            const db = admin.firestore();

            // This is the "guest list"
            // It finds the user, then finds their 'purchases' collection,
            // then creates a document named 'main-course'
            const purchaseRef = db.doc(`users/${userId}/purchases/main-course`);

            // Set 'unlocked' to true!
            // This is what the website is listening for.
            await purchaseRef.set({
              unlocked: true,
              purchaseDate: admin.firestore.FieldValue.serverTimestamp(),
              stripeSessionId: session.id,
              planAmount: session.amount_total, // e.g., 500 for $5.00
            });

            console.log(`🎉 Course unlocked for user: ${userId}`);
          } else {
            console.warn(
                "⚠️ Payment successful, " +
                "but no client_reference_id (userId) was found in session.",
            );
          }
        }

        // 4. Send a success response back to Stripe
        res.status(200).json({received: true});
      } catch (err) {
        console.error("Error handling webhook:", err);
        res.status(500).json({error: "Server error"});
      }
    },
);

// Expose our express app as a Firebase Function
// The name "stripeWebhookHandler" is what becomes part of the URL.
exports.stripeWebhookHandler = functions.https.onRequest(app);
