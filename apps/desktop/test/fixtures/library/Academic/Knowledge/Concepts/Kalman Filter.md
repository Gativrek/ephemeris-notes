---
title: Kalman Filter
tags: [estimation, filtering]
aliases: [KF]
---
# Kalman Filter

The filter alternates a prediction and a measurement update. See also [[RTK vs PPP]] and #estimation.

## Prediction

$$
\hat{x}_{k|k-1} = F \hat{x}_{k-1|k-1}
$$ {#eq:kf-predict}

$$ P_{k|k-1} = F P_{k-1|k-1} F^\top + Q $$

## Gain and update

The gain in @eq:kf-gain weighs the innovation; the state update is @eq:kf-update.

$$ K_k = P_{k|k-1} H^\top (H P_{k|k-1} H^\top + R)^{-1} $$ {#eq:kf-gain}

$$ \hat{x}_{k|k} = \hat{x}_{k|k-1} + K_k (z_k - H \hat{x}_{k|k-1}) $$ {#eq:kf-update}

Costs $5 and $10 are not math. Inline math: $z = Hx + v$. ^kf-summary

```matlab kf_update.m
K = (P*H') / (H*P*H' + R);
x = x + K*(z - H*x);  % update
```
